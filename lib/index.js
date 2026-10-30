import { createHash, randomBytes, randomUUID } from "node:crypto";
import { credentialKey, credentialRef } from "@deepseek-ai/dsh-credentials";
import { createServer } from "node:http";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/constants.ts
const PROVIDER = "shengsuanyun";
const DISPLAY_NAME = "胜算云";
const API_KEY_ENV = "SHENGSUANYUN_API_KEY";
const DEFAULT_MODEL = "deepseek-v4-flash";
const ROUTER_BASE_URL = "https://router.shengsuanyun.com/api/v1";
const ROUTER_MODELS_URL$1 = `${ROUTER_BASE_URL}/models`;
const AUTH_PAGE_URL$1 = "https://router.shengsuanyun.com/auth";
const ACCOUNT_KEYS_URL = "https://api.shengsuanyun.com/auth/keys";
const ACCOUNT_INFO_URL = "https://api.shengsuanyun.com/user/info";
/** App channel the ShengSuanYun authorization page expects. */
const AUTH_CHANNEL$1 = "CH_B51KXQ98";
const LLM_SETTINGS = "llm-pi-ai";
const API_PREFIX = "/api/shengsuanyun";
const MODEL_CONTEXT_WINDOW = 128e3;
const MODEL_MAX_TOKENS = 32768;
function modelSeed(id, name = id) {
	return {
		id,
		name,
		contextWindow: MODEL_CONTEXT_WINDOW,
		maxTokens: MODEL_MAX_TOKENS,
		input: ["text"]
	};
}
/** The route LoomLoom Desktop preconfigures for chat. */
function defaultProviderProfile() {
	return {
		displayName: DISPLAY_NAME,
		apiKeyEnv: API_KEY_ENV,
		api: "openai-completions",
		baseURL: ROUTER_BASE_URL,
		models: [modelSeed(DEFAULT_MODEL, "DeepSeek V4 Flash")]
	};
}
//#endregion
//#region src/errors.ts
var ShengsuanyunError = class extends Error {
	status;
	reason;
	constructor(status, message, reason) {
		super(message);
		this.status = status;
		this.name = "ShengsuanyunError";
		this.reason = reason;
	}
};
function reasonOf(cause) {
	if (cause instanceof ShengsuanyunError) return cause.reason;
	if (cause instanceof Error && /取消/u.test(cause.message)) return "authorization-cancelled";
	if (cause instanceof Error && /超时/u.test(cause.message)) return "authorization-timeout";
	return "credential-save-failed";
}
//#endregion
//#region src/auth.ts
const MAX_EXCHANGE_BYTES$1 = 64 * 1024;
const AUTH_TIMEOUT_MS$1 = 5 * 6e4;
function successCode$1(value) {
	return value === 0 || value === "0";
}
function nonBlank(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/** Pull the shared API key out of the authorization exchange body. */
function credentialFromEnvelope(payload) {
	const outer = typeof payload.data === "object" && payload.data !== null ? payload.data : {};
	const inner = typeof outer.data === "object" && outer.data !== null ? outer.data : {};
	const apiKey = nonBlank(inner.api_key ?? outer.api_key ?? payload.data) ?? nonBlank(inner.jwt_token ?? outer.jwt_token ?? payload.jwt_token);
	return apiKey === void 0 ? void 0 : { apiKey };
}
function authorizeUrl(authPageUrl, callbackUrl, state, verifier) {
	const authorize = new URL(authPageUrl);
	authorize.searchParams.set("app_name", "dsh");
	authorize.searchParams.set("callback_url", callbackUrl);
	authorize.searchParams.set("from", AUTH_CHANNEL$1);
	authorize.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
	authorize.searchParams.set("code_challenge_method", "S256");
	authorize.searchParams.set("state", state);
	return authorize.toString();
}
function callbackPage$1(res, ok) {
	const title = ok ? "正在验证授权" : "授权失败";
	const heading = ok ? "授权信息已收到" : "授权未完成";
	const detail = ok ? "dsh 正在验证并保存 API Key，请回到 dsh 查看结果。" : "请回到 dsh 后重新登录。";
	res.statusCode = ok ? 200 : 400;
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-content-type-options", "nosniff");
	res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><body><main><h1>${heading}</h1><p>${detail}</p></main></body></html>`);
}
async function listen$1(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("胜算云回调没有绑到本机端口");
	return address.port;
}
async function closeServer(server) {
	await new Promise((resolve) => server.close(() => resolve()));
}
async function exchangeCode$1(code, verifier, callbackUrl, signal, accountKeysUrl) {
	let response;
	try {
		const endpoint = new URL(accountKeysUrl);
		endpoint.searchParams.set("from", AUTH_CHANNEL$1);
		response = await fetch(endpoint, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json"
			},
			body: JSON.stringify({
				code,
				code_verifier: verifier,
				callback_url: callbackUrl
			}),
			redirect: "manual",
			signal
		});
	} catch {
		throw new ShengsuanyunError(502, "胜算云授权服务暂时不可用", "router-validation-failed");
	}
	const body = await response.text();
	if (body.length > MAX_EXCHANGE_BYTES$1) throw new ShengsuanyunError(502, "胜算云授权响应过大", "router-validation-failed");
	if (!response.ok) throw new ShengsuanyunError(response.status, "胜算云授权码兑换失败", "router-validation-failed");
	let payload;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new ShengsuanyunError(502, "胜算云授权响应无效", "router-validation-failed");
	}
	if (!successCode$1(payload.code)) throw new ShengsuanyunError(502, "胜算云授权码兑换失败", "router-validation-failed");
	const value = credentialFromEnvelope(payload);
	if (value === void 0) throw new ShengsuanyunError(502, "胜算云授权未返回有效凭据", "router-validation-failed");
	return value;
}
/** One loopback login. The verifier stays in this process. */
async function beginBrowserAuthorization$1(signal) {
	const verifier = randomBytes(32).toString("base64url");
	const state = randomBytes(16).toString("base64url");
	let settle = () => {};
	let reject = () => {};
	let consumed = false;
	let callbackUrl = "";
	const result = new Promise((resolve, rejectResult) => {
		settle = resolve;
		reject = rejectResult;
	});
	const server = createServer((req, res) => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.method !== "GET" || requestUrl.pathname !== "/callback" || consumed) {
			callbackPage$1(res, false);
			return;
		}
		if (requestUrl.searchParams.get("state") !== state) {
			callbackPage$1(res, false);
			return;
		}
		if (requestUrl.searchParams.get("error") !== null) {
			consumed = true;
			callbackPage$1(res, false);
			reject(new ShengsuanyunError(400, "胜算云授权已取消", "authorization-cancelled"));
			return;
		}
		const code = requestUrl.searchParams.get("code");
		if (code === null || code.trim() === "") {
			callbackPage$1(res, false);
			return;
		}
		consumed = true;
		callbackPage$1(res, true);
		exchangeCode$1(code, verifier, callbackUrl, signal, ACCOUNT_KEYS_URL).then(settle, reject);
	});
	callbackUrl = `http://127.0.0.1:${await listen$1(server)}/callback?state=${encodeURIComponent(state)}`;
	const timeout = setTimeout(() => reject(new ShengsuanyunError(408, "等待胜算云浏览器授权超时", "authorization-timeout")), AUTH_TIMEOUT_MS$1);
	const abort = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
	signal.addEventListener("abort", abort, { once: true });
	result.finally(async () => {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
		await closeServer(server);
	}).catch(() => {});
	return {
		url: authorizeUrl(AUTH_PAGE_URL$1, callbackUrl, state, verifier),
		result
	};
}
//#endregion
//#region src/account.ts
const MAX_ACCOUNT_RESPONSE_BYTES$1 = 256 * 1024;
const IDENTITY_FIELDS$1 = [
	"uid",
	"id",
	"userId",
	"displayName",
	"display_name",
	"name",
	"Nickname",
	"nickname",
	"Username",
	"username"
];
const ENVELOPES = [
	"data",
	"user",
	"userInfo",
	"profile",
	"account",
	"result"
];
function record$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function text$3(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim();
	return normalized === "" ? void 0 : normalized;
}
function userRecord$1(payload) {
	const queue = [payload];
	const visited = /* @__PURE__ */ new Set();
	while (queue.length > 0) {
		const candidate = queue.shift();
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) || visited.has(candidate)) continue;
		visited.add(candidate);
		const current = candidate;
		if (IDENTITY_FIELDS$1.some((field) => field in current)) return current;
		for (const key of ENVELOPES) queue.push(current[key]);
	}
	return {};
}
/** Display name from the account payload. Anything else stays on the host. */
function accountDisplayName(payload) {
	const user = userRecord$1(payload);
	return text$3(user.displayName ?? user.display_name ?? user.name ?? user.Nickname ?? user.nickname ?? user.Username ?? user.username);
}
async function boundedBody$1(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_ACCOUNT_RESPONSE_BYTES$1) {
		await response.body?.cancel();
		return "";
	}
	const reader = response.body?.getReader();
	if (reader === void 0) return "";
	const chunks = [];
	let size = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		size += next.value.byteLength;
		if (size > MAX_ACCOUNT_RESPONSE_BYTES$1) {
			await reader.cancel();
			return "";
		}
		chunks.push(next.value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
/** Best-effort nickname. A failure leaves the connection usable. */
async function readAccountName(token, signal) {
	try {
		const response = await fetch(ACCOUNT_INFO_URL, {
			headers: {
				accept: "application/json",
				"x-token": token
			},
			signal
		});
		if (!response.ok) return void 0;
		const body = await boundedBody$1(response);
		if (body === "") return void 0;
		const payload = JSON.parse(body);
		const envelope = record$2(payload);
		if (typeof envelope.code === "number" && envelope.code !== 0) return void 0;
		return accountDisplayName(payload);
	} catch {
		return;
	}
}
//#endregion
//#region src/flow.ts
function maskToken$1(token) {
	const normalized = token.trim();
	return normalized.length < 4 ? "····" : `····${normalized.slice(-4)}`;
}
/**
* Whether startup should write the ShengSuanYun route.
* An existing route is left alone, including a hand-edited base URL.
*/
function providerNeedsDeclare(section) {
	if (typeof section !== "object" || section === null || Array.isArray(section)) return true;
	const providers = section.providers;
	if (typeof providers !== "object" || providers === null || Array.isArray(providers)) return true;
	return providers[PROVIDER] === void 0;
}
function shouldSelectDefault(useAsDefault, modelIds) {
	if (!useAsDefault) return "skip";
	return modelIds.includes("deepseek-v4-flash") ? "select" : "choose";
}
function capModelIds(ids) {
	const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))];
	unique.sort((left, right) => {
		if (left === "deepseek-v4-flash") return -1;
		if (right === "deepseek-v4-flash") return 1;
		return left.localeCompare(right);
	});
	return unique.slice(0, 100);
}
/** Append one chosen model. `undefined` means the catalog already has it. */
function withRememberedModel(existing, modelId, seed) {
	const models = existing ?? [];
	if (models.some((model) => model.id === modelId)) return void 0;
	return [...models, seed];
}
//#endregion
//#region src/provider.ts
const LLM_NS = settingsNamespace(LLM_SETTINGS);
function modelsOf(section) {
	if (typeof section !== "object" || section === null) return void 0;
	const models = section.providers?.[PROVIDER]?.models;
	if (!Array.isArray(models)) return void 0;
	return models.filter((item) => typeof item === "object" && item !== null && typeof item.id === "string");
}
/** Add the desktop route once. A route that is already there is not rewritten. */
async function ensureProvider(ctx) {
	const current = ctx.settings.get(LLM_NS);
	if (current === void 0) {
		ctx.logger.warn("shengsuanyun: llm-pi-ai settings are not registered, so the provider route was not added");
		return;
	}
	if (!providerNeedsDeclare(current)) return;
	await ctx.settings.update(LLM_NS, { providers: { [PROVIDER]: defaultProviderProfile() } });
	ctx.logger.info("shengsuanyun: declared provider route shengsuanyun");
}
/** Put a chosen chat model on the route without dropping models already listed. */
async function rememberModel(ctx, modelId) {
	const next = withRememberedModel(modelsOf(ctx.settings.get(LLM_NS)), modelId, modelSeed(modelId));
	if (next === void 0) return;
	await ctx.settings.update(LLM_NS, { providers: { [PROVIDER]: { models: next } } });
}
async function selectDefaultModel(ctx, modelId) {
	await rememberModel(ctx, modelId);
	await ctx.agentDefaultModel.saveSelection({
		provider: PROVIDER,
		model: modelId
	});
}
function currentProviderModel(ctx) {
	const selection = ctx.agentDefaultModel.currentSelection();
	return selection.provider === "shengsuanyun" ? selection.model : void 0;
}
//#endregion
//#region src/router.ts
const MAX_ROUTER_MODELS_BYTES$1 = 2 * 1024 * 1024;
function stringList$1(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.toLowerCase()) : [];
}
function supportsChatCompletions$1(item) {
	const declared = [
		...stringList$1(item.capabilities),
		...stringList$1(item.supported_generation_methods),
		...stringList$1(item.supportedGenerationMethods),
		...stringList$1(item.supported_endpoints),
		...stringList$1(item.supportedEndpoints)
	];
	if (declared.length === 0) return true;
	return declared.some((value) => value === "chat" || value === "chat-completions" || value === "chat_completions" || value.endsWith("/chat/completions"));
}
/** Chat model ids from a ShengSuanYun router `/models` payload. */
function routerModelIds(payload) {
	if (typeof payload !== "object" || payload === null || !Array.isArray(payload.data)) throw new ShengsuanyunError(502, "胜算云模型目录响应无效", "router-validation-failed");
	const ids = payload.data.flatMap((item) => {
		if (typeof item !== "object" || item === null) return [];
		const record = item;
		if (!supportsChatCompletions$1(record)) return [];
		const id = record.id;
		return typeof id === "string" && id.trim() !== "" ? [id.trim()] : [];
	});
	if (ids.length === 0) throw new ShengsuanyunError(422, "胜算云账号当前没有可用聊天模型", "no-chat-model");
	return ids;
}
async function boundedBody(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_ROUTER_MODELS_BYTES$1) {
		await response.body?.cancel();
		throw new ShengsuanyunError(502, "胜算云模型目录响应过大", "router-validation-failed");
	}
	const reader = response.body?.getReader();
	if (reader === void 0) return "";
	const chunks = [];
	let size = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		size += next.value.byteLength;
		if (size > MAX_ROUTER_MODELS_BYTES$1) {
			await reader.cancel();
			throw new ShengsuanyunError(502, "胜算云模型目录响应过大", "router-validation-failed");
		}
		chunks.push(next.value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
/** Host-only check that this key can list chat models. The key never leaves this function. */
async function listChatModels(token, signal) {
	let response;
	try {
		response = await fetch(ROUTER_MODELS_URL$1, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${token}`
			},
			signal
		});
	} catch {
		throw new ShengsuanyunError(502, "胜算云模型服务暂时不可用", "router-validation-failed");
	}
	const body = await boundedBody(response);
	if (!response.ok) throw new ShengsuanyunError(response.status, "胜算云模型凭据验证失败", "router-validation-failed");
	let payload;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new ShengsuanyunError(502, "胜算云模型目录响应无效", "router-validation-failed");
	}
	return routerModelIds(payload);
}
//#endregion
//#region src/login.ts
const SESSION_TTL_MS$1 = 10 * 6e4;
const MAX_PENDING = 3;
const TOKEN_LIMIT = 8192;
const ref = credentialRef(API_KEY_ENV);
function finalState(state) {
	return state === "complete" || state === "cancelled" || state === "failed";
}
var ShengsuanyunLogin = class {
	ctx;
	#sessions = /* @__PURE__ */ new Map();
	constructor(ctx) {
		this.ctx = ctx;
	}
	async start(useAsDefault) {
		this.#sweep();
		if ([...this.#sessions.values()].filter((session) => !finalState(session.state)).length >= MAX_PENDING) throw new ShengsuanyunError(429, "已有进行中的胜算云登录", "invalid-request");
		const controller = new AbortController();
		const previous = await this.ctx.credentials.resolve(ref);
		const authorization = await beginBrowserAuthorization$1(controller.signal);
		const session = this.#open(controller, previous?.value, useAsDefault);
		authorization.result.then(async (credential) => {
			if (finalState(session.state)) return;
			await this.#finishCredential(session, credential.apiKey);
		}).catch((cause) => {
			if (controller.signal.aborted || finalState(session.state)) this.#finish(session, "cancelled", "authorization-cancelled");
			else this.#finish(session, "failed", reasonOf(cause));
		});
		return {
			sessionId: session.id,
			url: authorization.url
		};
	}
	status(sessionId) {
		this.#sweep();
		const session = this.#sessions.get(sessionId);
		if (session === void 0) return void 0;
		return {
			state: session.state,
			...session.reason === void 0 ? {} : { reason: session.reason },
			...session.state === "model-selection-required" ? { models: capModelIds(session.modelIds) } : {}
		};
	}
	async cancel(sessionId) {
		const session = this.#sessions.get(sessionId);
		if (session === void 0 || finalState(session.state)) return;
		session.controller.abort();
		await this.#restore(session);
		this.#finish(session, "cancelled", "authorization-cancelled");
	}
	async saveToken(token, useAsDefault, signal) {
		const normalized = token.trim();
		if (normalized === "" || normalized.length > TOKEN_LIMIT) throw new ShengsuanyunError(400, "胜算云 API Key 不能为空", "invalid-request");
		const previous = await this.ctx.credentials.resolve(ref);
		const modelIds = await listChatModels(normalized, signal);
		await this.ctx.credentials.set(ref, normalized);
		try {
			return await this.#afterStore(modelIds, useAsDefault);
		} catch (cause) {
			await this.#putBack(previous?.value);
			throw cause;
		}
	}
	async chooseModel(modelId, signal) {
		const token = await this.#token();
		if (token === void 0) throw new ShengsuanyunError(401, "还没有胜算云 API Key", "invalid-request");
		if (!(await listChatModels(token, signal)).includes(modelId)) throw new ShengsuanyunError(422, "这个模型不在当前账号的聊天模型里", "no-chat-model");
		await selectDefaultModel(this.ctx, modelId);
		for (const session of this.#sessions.values()) if (session.state === "model-selection-required") this.#finish(session, "complete");
	}
	async logout() {
		await this.ctx.credentials.unset(ref);
	}
	async snapshot(signal) {
		const info = await this.ctx.credentials.describe(ref);
		const selected = currentProviderModel(this.ctx);
		if (!info.configured) return {
			configured: false,
			writable: info.writable,
			model: {
				provider: PROVIDER,
				...selected === void 0 ? {} : { id: selected },
				ready: false
			}
		};
		const token = await this.#token();
		const [models, accountName] = await Promise.all([token === void 0 ? Promise.resolve(void 0) : listChatModels(token, signal).catch(() => void 0), token === void 0 ? Promise.resolve(void 0) : readAccountName(token, signal)]);
		const ready = models !== void 0 && selected !== void 0 && models.includes(selected);
		return {
			configured: true,
			writable: info.writable,
			...token === void 0 ? {} : { maskedToken: maskToken$1(token) },
			...accountName === void 0 ? {} : { accountName },
			model: {
				provider: PROVIDER,
				...selected === void 0 ? {} : { id: selected },
				ready
			},
			...models === void 0 ? {} : { chatModels: capModelIds(models) }
		};
	}
	async dispose() {
		for (const session of this.#sessions.values()) {
			clearTimeout(session.expiryTimer);
			session.controller.abort();
			await this.#restore(session);
		}
		this.#sessions.clear();
	}
	async #finishCredential(session, token) {
		session.state = "verifying";
		try {
			const modelIds = await listChatModels(token, session.controller.signal);
			if (session.controller.signal.aborted) return;
			await this.ctx.credentials.set(ref, token);
			session.wrote = true;
			session.modelIds = modelIds;
			const decision = shouldSelectDefault(session.useAsDefault, modelIds);
			if (decision === "choose") {
				this.#finish(session, "model-selection-required");
				return;
			}
			if (decision === "select") await selectDefaultModel(this.ctx, DEFAULT_MODEL);
			if (session.controller.signal.aborted) {
				await this.#restore(session);
				this.#finish(session, "cancelled", "authorization-cancelled");
				return;
			}
			session.wrote = false;
			this.#finish(session, "complete");
		} catch (cause) {
			if (session.wrote) await this.#restore(session);
			if (session.controller.signal.aborted) this.#finish(session, "cancelled", "authorization-cancelled");
			else this.#finish(session, "failed", reasonOf(cause));
		}
	}
	async #afterStore(modelIds, useAsDefault) {
		const decision = shouldSelectDefault(useAsDefault, modelIds);
		if (decision === "select") await selectDefaultModel(this.ctx, DEFAULT_MODEL);
		if (decision === "choose") return {
			state: "model-selection-required",
			models: capModelIds(modelIds)
		};
		return { state: "complete" };
	}
	async #token() {
		return (await this.ctx.credentials.resolve(ref))?.value;
	}
	async #putBack(previous) {
		if (previous === void 0) await this.ctx.credentials.unset(ref);
		else await this.ctx.credentials.set(ref, previous);
	}
	async #restore(session) {
		if (!session.wrote) return;
		await this.#putBack(session.previous);
		session.wrote = false;
	}
	#open(controller, previous, useAsDefault) {
		const id = randomBytes(24).toString("base64url");
		const expiryTimer = setTimeout(() => {
			this.#expire(id);
		}, SESSION_TTL_MS$1);
		expiryTimer.unref?.();
		const session = {
			id,
			controller,
			previous,
			useAsDefault,
			expiresAt: Date.now() + SESSION_TTL_MS$1,
			expiryTimer,
			modelIds: [],
			wrote: false,
			state: "pending"
		};
		this.#sessions.set(id, session);
		return session;
	}
	#finish(session, state, reason) {
		if (finalState(session.state)) return;
		session.state = state;
		if (state === "complete") session.wrote = false;
		if (reason === void 0) delete session.reason;
		else session.reason = reason;
	}
	async #expire(sessionId) {
		const session = this.#sessions.get(sessionId);
		if (session === void 0) return;
		if (!finalState(session.state)) {
			session.controller.abort();
			await this.#restore(session);
			this.#finish(session, "failed", "authorization-timeout");
		}
		setTimeout(() => this.#sessions.delete(sessionId), 6e4).unref?.();
	}
	#sweep() {
		const now = Date.now();
		for (const [id, session] of this.#sessions) if (session.expiresAt <= now && finalState(session.state)) this.#sessions.delete(id);
	}
};
//#endregion
//#region src/market/loom-api.ts
const DEFAULT_BASE_URL = "https://loomloom.shengsuanyun.com/loom/v1";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Workbook downloads are binary and larger than JSON responses. */
const MAX_BINARY_BYTES = 16 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 3e4;
/**
* Opaque Market listing id. Shared by configuration parsing and the Host routes
* so a configured storefront id can never become a path-shaping value.
*/
const MARKET_LISTING_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/u;
/**
* Operator override for the storefront allow-list.
*
* A comma-separated list of Market listing ids. When this variable is set it
* **wins over** the composed config, so a demo or a local run can point the
* market at another creator without editing a build file. It follows the same
* shape as the credential knobs (`apiKeyEnv` / `tokenRef`): the environment names
* the value, the config carries the default.
*
* Leaving it unset keeps the build's pinned storefront, which is the deterministic
* behaviour a shipped white-label client wants.
*/
const STOREFRONT_IDS_ENV = "LOOMLOOM_STOREFRONT_IDS";
/**
* Reads the override list.
*
* Entries are split on commas and trimmed; blank entries are dropped so a
* trailing comma is not an error. An unset or all-blank variable reads as "no
* override", not as "no storefront" — clearing a build's storefront should take
* an explicit empty config, not a stray empty environment variable.
*/
function envStorefrontListingIds(env) {
	const raw = env[STOREFRONT_IDS_ENV];
	if (raw === void 0) return void 0;
	const entries = raw.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
	return entries.length === 0 ? void 0 : entries;
}
/** Reject a configured id early, at composition time, instead of at first render. */
function storefrontListingId(value) {
	const id = typeof value === "string" ? value.trim() : "";
	if (id === "") throw new Error("loomloom storefrontListingIds must not contain an empty id");
	if (!MARKET_LISTING_ID_PATTERN.test(id)) throw new Error(`loomloom storefrontListingIds entry is not a Market listing id: ${id}`);
	return id;
}
/** Deduplicate configured storefront ids while preserving authoring order. */
function normalizeStorefrontListingIds(value) {
	if (value === void 0 || value === null) return [];
	if (!Array.isArray(value)) throw new Error("loomloom storefrontListingIds must be an array of Market listing ids");
	const seen = /* @__PURE__ */ new Set();
	const normalized = [];
	for (const entry of value) {
		const id = storefrontListingId(entry);
		if (seen.has(id)) continue;
		seen.add(id);
		normalized.push(id);
	}
	return normalized;
}
var LoomApiError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
		this.name = "LoomApiError";
	}
};
/** Make an upstream filename safe for a Content-Disposition response header. */
function sanitizeDownloadFilename(value) {
	let decoded = value.trim();
	try {
		decoded = decodeURIComponent(decoded);
	} catch {}
	const filename = decoded.replace(/[\u0000-\u001F\u007F"\\/:*?<>|]/gu, "_").trim();
	return filename === "" ? void 0 : filename;
}
/** Extract the preferred `filename*` or `filename` Content-Disposition parameter. */
function suggestedFilename(header) {
	if (header === null) return void 0;
	const extended = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/iu.exec(header)?.[1];
	const plain = /(?:^|;)\s*filename="?([^";]+)"?/iu.exec(header)?.[1];
	return extended === void 0 && plain === void 0 ? void 0 : sanitizeDownloadFilename(extended ?? plain ?? "");
}
/**
* Resolves the effective plugin configuration.
* @param config - the composed `cordis.patch.yml` config for this plugin row.
* @param env - environment consulted for the storefront override. Passed in
*   rather than read from `process.env` so a caller (and a test) controls it.
*/
function resolveLoomConfig(config = {}, env = process.env) {
	const rawUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	const baseUrl = new URL(rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`);
	if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.hash) throw new Error("loomloom baseUrl must be an HTTPS origin without credentials or fragment");
	const tokenRef = config.tokenRef ?? config.tokenEnv ?? "SHENGSUANYUN_API_KEY";
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenRef)) throw new Error("loomloom tokenRef must be a POSIX environment variable name");
	const token = config.token === void 0 || config.token.trim() === "" ? void 0 : config.token.trim();
	const creatorKeyEnv = config.creatorKeyEnv === void 0 ? void 0 : config.creatorKeyEnv.trim();
	if (creatorKeyEnv !== void 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(creatorKeyEnv)) throw new Error("loomloom creatorKeyEnv must be a POSIX environment variable name");
	return {
		baseUrl,
		token,
		tokenRef,
		creatorKeyEnv,
		storefrontListingIds: normalizeStorefrontListingIds(creatorKeyEnv === void 0 ? envStorefrontListingIds(env) ?? config.storefrontListingIds : config.storefrontListingIds)
	};
}
async function readBoundedBody(response) {
	const reader = response.body?.getReader();
	if (reader === void 0) return "";
	const chunks = [];
	let size = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		size += next.value.byteLength;
		if (size > MAX_RESPONSE_BYTES) {
			await reader.cancel().catch(() => void 0);
			throw new LoomApiError(502, "loomloom response exceeded size limit");
		}
		chunks.push(next.value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
async function readBoundedBinary(response) {
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_BINARY_BYTES) throw new LoomApiError(502, "loomloom workbook response exceeded size limit");
	const reader = response.body?.getReader();
	if (reader === void 0) return Buffer.alloc(0);
	const chunks = [];
	let size = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		size += next.value.byteLength;
		if (size > MAX_BINARY_BYTES) {
			await reader.cancel().catch(() => void 0);
			throw new LoomApiError(502, "loomloom workbook response exceeded size limit");
		}
		chunks.push(next.value);
	}
	return Buffer.concat(chunks);
}
var LoomApi = class {
	config;
	resolveToken;
	constructor(config, resolveToken = async () => config.token) {
		this.config = config;
		this.resolveToken = resolveToken;
	}
	requestSignal(signal) {
		const timeout = AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);
		return {
			signal: signal === void 0 ? timeout : AbortSignal.any([signal, timeout]),
			timeout
		};
	}
	transportFailure(signal, timeout) {
		if (signal?.aborted) return new LoomApiError(499, "loomloom request was cancelled");
		if (timeout.aborted) return new LoomApiError(504, "loomloom service timed out");
		return new LoomApiError(502, "loomloom service is unavailable");
	}
	async request(path, init = {}, signal) {
		if (!path.startsWith("/") || path.startsWith("//")) throw new Error("loomloom path must be absolute and local to configured API");
		const headers = new Headers(init.headers);
		headers.set("accept", "application/json");
		const token = await this.resolveToken();
		if (token !== void 0 && token.trim() !== "") headers.set("authorization", `Bearer ${token.trim()}`);
		if (init.body !== void 0) headers.set("content-type", "application/json");
		const requestSignal = this.requestSignal(signal);
		let response;
		try {
			response = await fetch(new URL(path.slice(1), this.config.baseUrl), {
				...init,
				headers,
				signal: requestSignal.signal
			});
		} catch {
			throw this.transportFailure(signal, requestSignal.timeout);
		}
		const text = await readBoundedBody(response);
		let payload = null;
		try {
			payload = text === "" ? null : JSON.parse(text);
		} catch {
			throw new LoomApiError(502, "loomloom returned invalid JSON");
		}
		if (!response.ok) {
			const message = typeof payload === "object" && payload !== null ? String(payload.error ?? payload.message ?? "loomloom request failed") : "loomloom request failed";
			throw new LoomApiError(response.status, message);
		}
		return payload;
	}
	/**
	* Fetch a binary response (an `.xlsx` workbook) and return it base64 encoded
	* together with the suggested filename. Binary endpoints never carry a JSON
	* error body, so a non-OK status is surfaced by status code alone.
	*/
	async requestBinary(path, init = {}, signal) {
		if (!path.startsWith("/") || path.startsWith("//")) throw new Error("loomloom path must be absolute and local to configured API");
		const headers = new Headers(init.headers);
		headers.set("accept", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream");
		const token = await this.resolveToken();
		if (token !== void 0 && token.trim() !== "") headers.set("authorization", `Bearer ${token.trim()}`);
		const requestSignal = this.requestSignal(signal);
		let response;
		try {
			response = await fetch(new URL(path.slice(1), this.config.baseUrl), {
				...init,
				headers,
				signal: requestSignal.signal
			});
		} catch {
			throw this.transportFailure(signal, requestSignal.timeout);
		}
		if (!response.ok) throw new LoomApiError(response.status, `loomloom workbook request failed with status ${response.status}`);
		const body = await readBoundedBinary(response);
		const filename = suggestedFilename(response.headers.get("content-disposition"));
		return {
			base64: body.toString("base64"),
			byteLength: body.byteLength,
			contentType: response.headers.get("content-type") ?? "application/octet-stream",
			...filename === void 0 ? {} : { filename }
		};
	}
};
//#endregion
//#region src/market/browser-auth.ts
const AUTH_PAGE_URL = "https://router.shengsuanyun.com/auth";
const ACCOUNT_API_URL$1 = "https://api.shengsuanyun.com/auth/keys";
const AUTH_CHANNEL = "CH_B51KXQ98";
const MAX_EXCHANGE_BYTES = 64 * 1024;
const AUTH_TIMEOUT_MS = 5 * 6e4;
const ROUTER_MODELS_URL = "https://router.shengsuanyun.com/api/v1/models";
const MAX_ROUTER_MODELS_BYTES = 2 * 1024 * 1024;
var RouterCredentialError = class extends LoomApiError {
	reason;
	constructor(reason, status, message) {
		super(status, message);
		this.reason = reason;
		this.name = "RouterCredentialError";
	}
};
function successCode(value) {
	return value === 0 || value === "0";
}
function nonBlankText(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function browserCredentialFromEnvelope(payload) {
	const outer = typeof payload.data === "object" && payload.data !== null ? payload.data : {};
	const inner = typeof outer.data === "object" && outer.data !== null ? outer.data : {};
	const apiKey = nonBlankText(inner.api_key ?? outer.api_key ?? payload.data);
	const identityToken = nonBlankText(inner.jwt_token ?? outer.jwt_token ?? payload.jwt_token);
	const sharedCredential = apiKey ?? identityToken;
	return sharedCredential === void 0 ? void 0 : {
		apiKey: sharedCredential,
		...identityToken === void 0 ? {} : { identityToken }
	};
}
function token(size) {
	return randomBytes(size).toString("base64url");
}
function challenge(verifier) {
	return createHash("sha256").update(verifier).digest("base64url");
}
function callbackPage(res, ok) {
	res.statusCode = ok ? 200 : 400;
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-content-type-options", "nosniff");
	res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${ok ? "正在验证授权" : "授权失败"}</title><body><main><h1>${ok ? "授权信息已收到" : "授权未完成"}</h1><p>${ok ? "DSH 正在验证并保存 API Key；请返回 DSH 查看最终登录状态。" : "请返回 DSH 后重新发起登录。"}</p></main></body></html>`);
}
async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("Loomloom callback did not bind a loopback port");
	return address.port;
}
async function close(server) {
	await new Promise((resolve) => server.close(() => resolve()));
}
async function exchangeCode(code, verifier, callbackUrl, signal, accountKeysUrl) {
	let response;
	try {
		const endpoint = new URL(accountKeysUrl);
		endpoint.searchParams.set("from", AUTH_CHANNEL);
		response = await fetch(endpoint, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json"
			},
			body: JSON.stringify({
				code,
				code_verifier: verifier,
				callback_url: callbackUrl
			}),
			redirect: "manual",
			signal
		});
	} catch {
		throw new LoomApiError(502, "胜算云授权服务暂时不可用");
	}
	const body = await response.text();
	if (body.length > MAX_EXCHANGE_BYTES) throw new LoomApiError(502, "胜算云授权响应过大");
	if (!response.ok) throw new LoomApiError(response.status, "胜算云授权码兑换失败");
	let payload;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new LoomApiError(502, "胜算云授权响应无效");
	}
	if (!successCode(payload.code)) throw new LoomApiError(502, "胜算云授权码兑换失败");
	const value = browserCredentialFromEnvelope(payload);
	if (value === void 0) throw new LoomApiError(502, "胜算云授权未返回有效凭据");
	return value;
}
function stringList(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.toLowerCase()) : [];
}
function supportsChatCompletions(item) {
	const declared = [
		...stringList(item.capabilities),
		...stringList(item.supported_generation_methods),
		...stringList(item.supportedGenerationMethods),
		...stringList(item.supported_endpoints),
		...stringList(item.supportedEndpoints)
	];
	if (declared.length === 0) return true;
	return declared.some((value) => value === "chat" || value === "chat-completions" || value === "chat_completions" || value.endsWith("/chat/completions"));
}
function routerModels(payload) {
	if (typeof payload !== "object" || payload === null || !Array.isArray(payload.data)) throw new RouterCredentialError("router-validation-failed", 502, "胜算云模型目录响应无效");
	const ids = payload.data.flatMap((item) => {
		if (typeof item !== "object" || item === null) return [];
		const record = item;
		if (!supportsChatCompletions(record)) return [];
		const id = record.id;
		return typeof id === "string" && id.trim() !== "" ? [id] : [];
	});
	if (ids.length === 0) throw new RouterCredentialError("no-chat-model", 422, "胜算云账号当前没有可用聊天模型");
	return ids;
}
async function boundedRouterBody(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_ROUTER_MODELS_BYTES) {
		await response.body?.cancel();
		throw new RouterCredentialError("router-validation-failed", 502, "胜算云模型目录响应过大");
	}
	const reader = response.body?.getReader();
	if (reader === void 0) return "";
	const chunks = [];
	let size = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		size += next.value.byteLength;
		if (size > MAX_ROUTER_MODELS_BYTES) {
			await reader.cancel();
			throw new RouterCredentialError("router-validation-failed", 502, "胜算云模型目录响应过大");
		}
		chunks.push(next.value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
/**
* Starts one loopback PKCE authorization. The verifier and state stay in this
* Host-only closure and the resulting credential is returned only to the
* authorization flow that initiated it.
*/
async function beginBrowserAuthorization(signal, options = {}) {
	const authPageUrl = options.authPageUrl ?? AUTH_PAGE_URL;
	const accountKeysUrl = options.accountKeysUrl ?? ACCOUNT_API_URL$1;
	const verifier = token(32);
	const state = token(16);
	let settle = () => {};
	let reject = () => {};
	let consumed = false;
	const result = new Promise((resolve, rejectResult) => {
		settle = resolve;
		reject = rejectResult;
	});
	const server = createServer((req, res) => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.method !== "GET" || requestUrl.pathname !== "/callback" || consumed) {
			callbackPage(res, false);
			return;
		}
		const code = requestUrl.searchParams.get("code");
		if (requestUrl.searchParams.get("state") !== state) {
			callbackPage(res, false);
			return;
		}
		if (requestUrl.searchParams.get("error") !== null) {
			consumed = true;
			callbackPage(res, false);
			reject(new LoomApiError(400, "胜算云授权已取消"));
			return;
		}
		if (code === null || code.trim() === "") {
			callbackPage(res, false);
			return;
		}
		consumed = true;
		callbackPage(res, true);
		(async () => {
			try {
				settle(await exchangeCode(code, verifier, callbackUrl, signal, accountKeysUrl));
			} catch (cause) {
				reject(cause);
			}
		})();
	});
	const callbackUrl = `http://127.0.0.1:${await listen(server)}/callback?state=${encodeURIComponent(state)}`;
	const authorize = new URL(authPageUrl);
	authorize.searchParams.set("app_name", "DSH Desktop");
	authorize.searchParams.set("callback_url", callbackUrl);
	authorize.searchParams.set("from", AUTH_CHANNEL);
	authorize.searchParams.set("code_challenge", challenge(verifier));
	authorize.searchParams.set("code_challenge_method", "S256");
	authorize.searchParams.set("state", state);
	const timeout = setTimeout(() => reject(new LoomApiError(408, "等待胜算云浏览器授权超时")), options.timeoutMs ?? AUTH_TIMEOUT_MS);
	const abort = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
	signal.addEventListener("abort", abort, { once: true });
	result.finally(async () => {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
		await close(server);
	}).catch(() => {});
	return {
		url: authorize.toString(),
		result
	};
}
/**
* Verifies the shared key against the model Router. This stays Host-only so
* neither the key nor the raw Router response can enter the renderer.
*/
async function verifyShengsuanyunRouterCredential(tokenValue, signal) {
	let response;
	try {
		response = await fetch(ROUTER_MODELS_URL, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${tokenValue}`
			},
			signal
		});
	} catch {
		throw new RouterCredentialError("router-validation-failed", 502, "胜算云模型服务暂时不可用");
	}
	const body = await boundedRouterBody(response);
	if (!response.ok) throw new RouterCredentialError("router-validation-failed", response.status, "胜算云模型凭据验证失败");
	let payload;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new RouterCredentialError("router-validation-failed", 502, "胜算云模型目录响应无效");
	}
	return routerModels(payload);
}
/** Verifies the Loom API half of the shared credential before it is persisted. */
async function verifyLoomCredential(tokenValue, config, signal) {
	await new LoomApi({
		...config,
		token: tokenValue
	}, async () => tokenValue).request("/users/me/runs?pageSize=1", {}, signal);
}
/** Verifies both Loom and Router access for callers that do not expose progress. */
async function verifyBrowserCredential(tokenValue, config, signal) {
	const [loom, router] = await Promise.allSettled([verifyLoomCredential(tokenValue, config, signal), verifyShengsuanyunRouterCredential(tokenValue, signal)]);
	if (loom.status === "rejected") throw loom.reason;
	if (router.status === "rejected") throw router.reason;
	return router.value;
}
//#endregion
//#region src/market/credentials.ts
const LOOMLOOM_CREDENTIAL_KEY = credentialKey("loomloom", "shengsuanyun");
function maskToken(token) {
	const normalized = token.trim();
	return normalized.length < 4 ? "····" : `····${normalized.slice(-4)}`;
}
function tokenFromRecord(record) {
	if (record?.kind !== "grant" || typeof record.payload !== "object" || record.payload === null) return void 0;
	const token = record.payload.token;
	return typeof token === "string" && token.trim() !== "" ? token.trim() : void 0;
}
function identityTokenFromRecord(record) {
	if (record?.kind !== "grant" || typeof record.payload !== "object" || record.payload === null) return void 0;
	const token = record.payload.identityToken;
	return typeof token === "string" && token.trim() !== "" ? token.trim() : void 0;
}
function grantPayload(record) {
	return record?.kind === "grant" && typeof record.payload === "object" && record.payload !== null && !Array.isArray(record.payload) ? { ...record.payload } : {};
}
/** Resolves a fresh secret for every upstream request; values never cross the Client boundary. */
function createLoomTokenResolver(ctx, config) {
	const ref = credentialRef(config.tokenRef);
	return async () => {
		if (config.token !== void 0) return config.token;
		const referenced = await ctx.credentials.resolve(ref);
		if (referenced !== void 0) return referenced.value;
		const records = ctx.credentials;
		return records.readRecord === void 0 ? void 0 : tokenFromRecord(await records.readRecord(LOOMLOOM_CREDENTIAL_KEY));
	};
}
/** Reads the browser-only JWT used exclusively for the account profile endpoint. */
function createLoomIdentityTokenResolver(ctx) {
	const records = ctx.credentials;
	return async () => records.readRecord === void 0 ? void 0 : identityTokenFromRecord(await records.readRecord(LOOMLOOM_CREDENTIAL_KEY));
}
/**
* Persist the common ShengSuanYun key under its credential reference.  DSH's
* custom provider UI derives the same reference from provider id
* `shengsuanyun`, so the Market and chat adapters resolve one stored value.
* Plugin-owned grant records remain read-only migration fallbacks.
*/
async function storeLoomToken(ctx, config, token) {
	await ctx.credentials.set(credentialRef(config.tokenRef), token);
}
/** Replaces the profile JWT without exposing it through a shared key reference. */
async function replaceLoomIdentityToken(ctx, token) {
	const records = ctx.credentials;
	if (records.modifyRecord === void 0) return;
	await records.modifyRecord(LOOMLOOM_CREDENTIAL_KEY, async (current) => {
		const payload = grantPayload(current);
		if (token === void 0) delete payload.identityToken;
		else payload.identityToken = token;
		return Object.keys(payload).length === 0 ? void 0 : {
			kind: "grant",
			payload
		};
	});
}
/** Remove the common reference and any legacy plugin grant during explicit logout. */
async function clearLoomToken(ctx, config) {
	if (config.token !== void 0) throw new Error("development token cannot be cleared from the desktop UI");
	await ctx.credentials.unset(credentialRef(config.tokenRef));
	const records = ctx.credentials;
	if (records.deleteRecord !== void 0) await records.deleteRecord(LOOMLOOM_CREDENTIAL_KEY);
}
/** Returns only credential presence/origin facts. Secret values never cross this boundary. */
function createLoomCredentialStatusReader(ctx, config) {
	const ref = credentialRef(config.tokenRef);
	return async () => {
		if (config.token !== void 0) return {
			configured: true,
			source: "development-token",
			maskedToken: maskToken(config.token)
		};
		if ((await ctx.credentials.describe(ref)).configured) {
			const credentials = ctx.credentials;
			const resolved = credentials.resolve === void 0 ? void 0 : await credentials.resolve(ref);
			return {
				configured: true,
				source: "reference",
				...resolved?.value === void 0 ? {} : { maskedToken: maskToken(resolved.value) }
			};
		}
		const records = ctx.credentials;
		const token = tokenFromRecord(records.readRecord === void 0 ? void 0 : await records.readRecord(LOOMLOOM_CREDENTIAL_KEY));
		return token !== void 0 ? {
			configured: true,
			source: "authorization-grant",
			maskedToken: maskToken(token)
		} : { configured: false };
	};
}
//#endregion
//#region src/market/default-model.ts
const SHENGSUANYUN_PROVIDER = "shengsuanyun";
const SHENGSUANYUN_DEFAULT_MODEL = "deepseek-v4-flash";
/**
* Persist the post-login default through DSH's first-class selection service.
* This is intentionally separate from the provider route: user settings take
* precedence over Cordis composition, so only a successful explicit Loomloom
* authorization may replace a pre-existing model choice.
*/
async function selectShengsuanyunDefaultModel(ctx) {
	const service = ctx.get("agentDefaultModel");
	if (service === void 0) throw new Error("DSH default-model service is unavailable");
	await service.saveSelection({
		provider: SHENGSUANYUN_PROVIDER,
		model: SHENGSUANYUN_DEFAULT_MODEL
	});
}
function currentShengsuanyunModel(ctx) {
	const selection = ctx.get("agentDefaultModel")?.currentSelection();
	return selection?.provider === "shengsuanyun" ? selection.model : void 0;
}
//#endregion
//#region src/market/authorization.ts
async function verifyAndStore(ctx, config, token, signal, identityToken) {
	const modelIds = await verifyBrowserCredential(token, config, signal);
	const previous = await ctx.credentials.resolve(credentialRef(config.tokenRef));
	await storeLoomToken(ctx, config, token);
	await replaceLoomIdentityToken(ctx, identityToken);
	if (!modelIds.includes("deepseek-v4-flash")) return;
	try {
		await selectShengsuanyunDefaultModel(ctx);
	} catch (cause) {
		if (previous === void 0) await clearLoomToken(ctx, config);
		else await storeLoomToken(ctx, config, previous.value);
		throw cause;
	}
}
/**
* Registers DSH's browser-first PKCE login plus its explicit API-token fallback.
*/
function registerLoomAuthorization(ctx, config) {
	const authorization = ctx.get("authorization");
	if (authorization === void 0) return () => {};
	return authorization.registerFlow({
		key: LOOMLOOM_CREDENTIAL_KEY,
		label: "Loomloom / 胜算云",
		methods: [{
			id: "browser",
			label: "在浏览器中登录胜算云（推荐）"
		}, {
			id: "api-token",
			label: "粘贴胜算云 API Key"
		}],
		async run(session) {
			if (session.method === "browser") {
				const browser = await beginBrowserAuthorization(session.signal);
				session.notify({
					message: "请在浏览器中完成胜算云授权；DSH 会在回环回调后验证并安全保存凭据。",
					url: browser.url
				});
				const credential = await browser.result;
				await verifyAndStore(ctx, config, credential.apiKey, session.signal, credential.identityToken);
				return;
			}
			if (session.method !== "api-token") throw new Error("不支持的 Loomloom 授权方式");
			const token = (await session.prompt({
				kind: "secret",
				message: "请输入胜算云 API Key。它将作为 Loomloom Market 与 DSH 模型 Provider 的共同凭据保存，不会显示在聊天或日志中。"
			})).trim();
			if (token === "") throw new Error("胜算云 API Key 不能为空");
			await verifyAndStore(ctx, config, token, session.signal);
		}
	});
}
//#endregion
//#region src/market/account.ts
const ACCOUNT_API_URL = "https://api.shengsuanyun.com/user/info";
const MAX_ACCOUNT_RESPONSE_BYTES = 256 * 1024;
const ACCOUNT_TIMEOUT_MS = 1e4;
function record$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function text$2(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim();
	return normalized === "" ? void 0 : normalized;
}
function scalarText(value) {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return text$2(value);
}
const IDENTITY_FIELDS = [
	"uid",
	"id",
	"userId",
	"ID",
	"UserID",
	"displayName",
	"display_name",
	"name",
	"Nickname",
	"NickName",
	"nickname",
	"nickName",
	"nick_name",
	"Username",
	"UserName",
	"username",
	"userName",
	"user_name"
];
const IDENTITY_ENVELOPES = [
	"data",
	"Data",
	"user",
	"User",
	"userInfo",
	"UserInfo",
	"userinfo",
	"profile",
	"Profile",
	"account",
	"Account",
	"result",
	"Result"
];
function isIdentityRecord(value) {
	return IDENTITY_FIELDS.some((field) => field in value);
}
/**
* The ShengSuanYun account endpoint has several deployed envelope variants.
* We traverse only recognized envelope names and return a record only when it
* contains an approved identity field; arbitrary upstream data never escapes.
*/
function userRecord(payload) {
	const queue = [payload];
	const visited = /* @__PURE__ */ new Set();
	while (queue.length > 0) {
		const candidate = queue.shift();
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) || visited.has(candidate)) continue;
		visited.add(candidate);
		const current = candidate;
		if (isIdentityRecord(current)) return current;
		for (const key of IDENTITY_ENVELOPES) queue.push(current[key]);
	}
	return {};
}
function listingItems(payload) {
	const root = record$1(payload);
	const data = record$1(root.data);
	if (Array.isArray(root.items)) return root.items;
	if (Array.isArray(data.items)) return data.items;
	if (Array.isArray(root.listings)) return root.listings;
	if (Array.isArray(data.listings)) return data.listings;
	return [];
}
function normalizeAccount(payload, isCreator) {
	const user = userRecord(payload);
	const account = { configured: true };
	const uid = text$2(user.uid ?? user.id ?? user.userId ?? user.ID ?? user.UserID);
	const displayName = text$2(user.displayName ?? user.display_name ?? user.name ?? user.Nickname ?? user.NickName ?? user.nickname ?? user.nickName ?? user.nick_name ?? user.Username ?? user.UserName ?? user.username ?? user.userName ?? user.user_name);
	const email = text$2(user.email ?? user.mail ?? user.Email);
	const photoUrl = text$2(user.photoUrl ?? user.photo_url ?? user.avatar ?? user.avatarUrl ?? user.HeadImg);
	const balance = scalarText(user.balance ?? user.balanceAmount ?? user.availableBalance);
	if (uid !== void 0) account.uid = uid;
	if (displayName !== void 0) account.displayName = displayName;
	if (email !== void 0) account.email = email;
	if (photoUrl !== void 0) account.photoUrl = photoUrl;
	if (balance !== void 0) account.balance = balance;
	if (isCreator !== void 0) account.isCreator = isCreator;
	return account;
}
function optionalRoleFailure(cause) {
	return cause instanceof Error && "status" in cause && (cause.status === 401 || cause.status === 403 || cause.status === 404);
}
async function boundedAccountBody(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_ACCOUNT_RESPONSE_BYTES) {
		await response.body?.cancel();
		throw new Error("loomloom account response exceeded size limit");
	}
	const reader = response.body?.getReader();
	if (reader === void 0) return "";
	const chunks = [];
	let size = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		size += next.value.byteLength;
		if (size > MAX_ACCOUNT_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error("loomloom account response exceeded size limit");
		}
		chunks.push(next.value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
function createLoomAccountReaderWithToken(api, resolveToken, resolveIdentityToken = resolveToken) {
	return async () => {
		const token = await resolveIdentityToken();
		if (token === void 0 || token.trim() === "") return { configured: true };
		const responsePromise = fetch(ACCOUNT_API_URL, {
			headers: {
				accept: "application/json",
				"x-token": token.trim()
			},
			signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS)
		});
		const creatorPromise = api.request("/creators/me/marketListings?pageSize=1").then((payload) => listingItems(payload).length > 0).catch((cause) => {
			if (optionalRoleFailure(cause)) return false;
		});
		const response = await responsePromise;
		const body = await boundedAccountBody(response);
		if (!response.ok) throw new LoomApiError(response.status, "loomloom account is unavailable");
		let userPayload;
		try {
			userPayload = JSON.parse(body);
		} catch {
			throw new Error("loomloom account returned invalid JSON");
		}
		const envelope = record$1(userPayload);
		if (typeof envelope.code === "number" && envelope.code !== 0) throw new LoomApiError(401, "loomloom account identity is unavailable");
		const isCreator = await creatorPromise;
		return normalizeAccount(userPayload, isCreator);
	};
}
//#endregion
//#region src/market/bootstrap.ts
const VALIDATION_TIMEOUT_MS = 1e4;
async function availability(run) {
	try {
		await run(AbortSignal.timeout(VALIDATION_TIMEOUT_MS));
		return true;
	} catch {
		return false;
	}
}
async function availableModels(run) {
	try {
		return await run(AbortSignal.timeout(VALIDATION_TIMEOUT_MS));
	} catch {
		return;
	}
}
function createLoomBootstrapReader(ctx, config, readCredentialStatus, resolveToken) {
	return async () => {
		const status = await readCredentialStatus();
		const credential = { configured: status.configured };
		if (!status.configured) return {
			credential,
			loom: "unknown",
			router: "unknown",
			model: {
				provider: SHENGSUANYUN_PROVIDER,
				ready: false
			}
		};
		const token = await resolveToken();
		if (token === void 0) return {
			credential,
			loom: "unavailable",
			router: "unavailable",
			model: {
				provider: SHENGSUANYUN_PROVIDER,
				ready: false
			}
		};
		const [loomReady, modelIds] = await Promise.all([availability((signal) => verifyLoomCredential(token, config, signal)), availableModels((signal) => verifyShengsuanyunRouterCredential(token, signal))]);
		const selection = ctx.get("agentDefaultModel")?.currentSelection();
		const selectedModel = selection?.provider === "shengsuanyun" ? selection.model : void 0;
		const modelReady = modelIds !== void 0 && selectedModel !== void 0 && modelIds.includes(selectedModel);
		return {
			credential,
			loom: loomReady ? "ready" : "unavailable",
			router: modelIds === void 0 ? "unavailable" : "ready",
			model: {
				provider: SHENGSUANYUN_PROVIDER,
				...selectedModel === void 0 ? {} : { id: selectedModel },
				ready: modelReady
			}
		};
	};
}
//#endregion
//#region src/market/browser-login.ts
const SESSION_TTL_MS = 10 * 6e4;
const MAX_PENDING_SESSIONS = 3;
/**
* A Host-only bridge for the Settings client.  It exposes a short-lived opaque
* session and authorization URL, never the PKCE verifier, callback code, or
* credential.  The exchanged credential is verified then written directly to
* the DSH credential backend.
*/
var LoomBrowserLoginService = class {
	ctx;
	config;
	#sessions = /* @__PURE__ */ new Map();
	#credentialOwner;
	#writingCredential = false;
	#disposeCredentialListener;
	#disposeSettingsListener;
	constructor(ctx, config) {
		this.ctx = ctx;
		this.config = config;
		const credentialEvents = ctx;
		this.#disposeCredentialListener = credentialEvents.on?.("credentials/reference-updated", (ref) => {
			if (ref === this.config.tokenRef && !this.#writingCredential) this.#credentialOwner = void 0;
		}) ?? (() => {});
		const settingsEvents = ctx;
		this.#disposeSettingsListener = settingsEvents.on?.("settings/document-updated", (namespace) => {
			if (namespace !== "agent-default-model") return;
			for (const session of this.#sessions.values()) if (session.state === "model-selection-required") this.reconcileModelSelection(session);
		}) ?? (() => {});
	}
	async start() {
		this.cleanup();
		if ([...this.#sessions.values()].filter((session) => !this.final(session.state)).length >= MAX_PENDING_SESSIONS) throw new Error("too many pending Loomloom login sessions");
		const controller = new AbortController();
		const previous = await this.ctx.credentials.resolve(credentialRef(this.config.tokenRef));
		const previousIdentityToken = await createLoomIdentityTokenResolver(this.ctx)();
		const authorization = await beginBrowserAuthorization(controller.signal);
		const sessionId = randomBytes(24).toString("base64url");
		const expiryTimer = setTimeout(() => {
			this.expire(sessionId);
		}, SESSION_TTL_MS);
		expiryTimer.unref?.();
		const session = {
			id: sessionId,
			controller,
			previousCredential: previous?.value,
			previousIdentityToken,
			expiresAt: Date.now() + SESSION_TTL_MS,
			expiryTimer,
			modelIds: [],
			wroteCredential: false,
			state: "pending"
		};
		this.#sessions.set(sessionId, session);
		authorization.result.then(async (credential) => {
			if (this.final(session.state)) return;
			session.state = "verifying-loom";
			try {
				const [loomResult, routerResult] = await Promise.allSettled([verifyLoomCredential(credential.apiKey, this.config, controller.signal), verifyShengsuanyunRouterCredential(credential.apiKey, controller.signal)]);
				if (controller.signal.aborted) {
					this.finish(session, "cancelled", "authorization-cancelled");
					return;
				}
				if (loomResult.status === "rejected") {
					this.finish(session, "failed", "loom-validation-failed");
					return;
				}
				if (routerResult.status === "rejected") throw routerResult.reason;
				const modelIds = routerResult.value;
				session.state = "verifying-router";
				session.modelIds = modelIds;
				await this.writeCredential(session, credential.apiKey, credential.identityToken);
				if (controller.signal.aborted) {
					await this.restoreCredential(session);
					this.finish(session, "cancelled", "authorization-cancelled");
					return;
				}
				if (!modelIds.includes("deepseek-v4-flash")) {
					this.finish(session, "model-selection-required");
					return;
				}
				if (controller.signal.aborted) {
					await this.restoreCredential(session);
					this.finish(session, "cancelled", "authorization-cancelled");
					return;
				}
				await selectShengsuanyunDefaultModel(this.ctx);
				if (controller.signal.aborted) {
					await this.restoreCredential(session);
					this.finish(session, "cancelled", "authorization-cancelled");
					return;
				}
				this.finish(session, "complete");
			} catch (cause) {
				if (session.wroteCredential) await this.restoreCredential(session);
				if (controller.signal.aborted) {
					this.finish(session, "cancelled", "authorization-cancelled");
					return;
				}
				this.finish(session, "failed", this.validationReason(cause));
			}
		}).catch((cause) => {
			if (controller.signal.aborted) this.finish(session, "cancelled", "authorization-cancelled");
			else this.finish(session, "failed", this.authorizationReason(cause));
		});
		return {
			sessionId,
			url: authorization.url
		};
	}
	status(sessionId) {
		this.cleanup();
		const session = this.#sessions.get(sessionId);
		if (session?.state === "model-selection-required") this.reconcileModelSelection(session);
		return session === void 0 ? void 0 : {
			state: session.state,
			...session.reason === void 0 ? {} : { reason: session.reason }
		};
	}
	async cancel(sessionId) {
		this.cleanup();
		const session = this.#sessions.get(sessionId);
		if (session === void 0 || this.final(session.state)) return;
		session.controller.abort();
		this.finish(session, "cancelled", "authorization-cancelled");
		await this.restoreCredential(session);
	}
	async dispose() {
		this.#disposeCredentialListener();
		this.#disposeSettingsListener();
		for (const session of this.#sessions.values()) {
			clearTimeout(session.expiryTimer);
			session.controller.abort();
			await this.restoreCredential(session);
		}
		this.#sessions.clear();
	}
	cleanup() {
		const now = Date.now();
		for (const [id, session] of this.#sessions) if (session.expiresAt <= now && this.final(session.state)) this.#sessions.delete(id);
	}
	final(state) {
		return state === "complete" || state === "cancelled" || state === "failed";
	}
	finish(session, state, reason) {
		if (this.final(session.state)) return;
		session.state = state;
		if (state === "complete") {
			session.wroteCredential = false;
			if (this.#credentialOwner === session.id) this.#credentialOwner = void 0;
		}
		if (reason === void 0) delete session.reason;
		else session.reason = reason;
	}
	authorizationReason(cause) {
		if (cause instanceof Error && /取消/u.test(cause.message)) return "authorization-cancelled";
		return cause instanceof Error && /超时/u.test(cause.message) ? "authorization-timeout" : "loom-validation-failed";
	}
	validationReason(cause) {
		if (cause instanceof RouterCredentialError) return cause.reason;
		return cause instanceof Error && /模型/u.test(cause.message) ? "router-validation-failed" : "credential-save-failed";
	}
	async restoreCredential(session) {
		if (!session.wroteCredential || this.#credentialOwner !== session.id) return;
		this.#writingCredential = true;
		try {
			if (session.previousCredential === void 0) await clearLoomToken(this.ctx, this.config);
			else await storeLoomToken(this.ctx, this.config, session.previousCredential);
			await replaceLoomIdentityToken(this.ctx, session.previousIdentityToken);
			session.wroteCredential = false;
			this.#credentialOwner = void 0;
		} finally {
			this.#writingCredential = false;
		}
	}
	async writeCredential(session, token, identityToken) {
		this.#writingCredential = true;
		try {
			await storeLoomToken(this.ctx, this.config, token);
			await replaceLoomIdentityToken(this.ctx, identityToken);
			session.wroteCredential = true;
			this.#credentialOwner = session.id;
		} finally {
			this.#writingCredential = false;
		}
	}
	reconcileModelSelection(session) {
		const selected = currentShengsuanyunModel(this.ctx);
		if (selected !== void 0 && session.modelIds.includes(selected)) this.finish(session, "complete");
	}
	async expire(sessionId) {
		const session = this.#sessions.get(sessionId);
		if (session === void 0) return;
		if (this.final(session.state)) {
			this.#sessions.delete(sessionId);
			return;
		}
		session.controller.abort();
		await this.restoreCredential(session);
		this.finish(session, "failed", "authorization-timeout");
		setTimeout(() => this.#sessions.delete(sessionId), 6e4).unref?.();
	}
};
//#endregion
//#region src/market/skill-package.ts
/**
* Backend-published Agent Skill packages.
*
* A Market listing can ship a ZIP archive containing a complete agent skill
* (a `SKILL.md` entry point plus references and scripts). Installing one means:
* verify the archive against the published sha256, unpack it, validate the
* skill shape, and place it atomically in an agent skill root with a marker
* recording the source and hash so a repeat install is a no-op.
*
* The upstream contract (mirrored from the official Go CLI) is:
*   GET /marketListings/{id}/skillPackage           -> summary with archiveHash
*   GET /marketListings/{id}/skillPackage/archive   -> the ZIP bytes
*/
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_SKILL_MD_BYTES = 500 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MARKER_NAME = ".loomloom-skill.json";
const END_OF_CENTRAL_DIRECTORY = 101010256;
const CENTRAL_FILE_HEADER = 33639248;
const LOCAL_FILE_HEADER = 67324752;
/** Normalize `sha256:<hex>` / `<hex>` into a lowercase bare hex digest. */
function normalizeArchiveHash(value) {
	const trimmed = value.trim().toLowerCase();
	return trimmed.startsWith("sha256:") ? trimmed.slice(7) : trimmed;
}
/**
* The agent skill root installed packages land in: `<DSH_HOME>/skills`, where
* `DSH_HOME` falls back to `~/.loomloom`. The path is derived from the host
* environment rather than a request so a client cannot choose a write target.
*/
function resolveDefaultSkillRoot(env = process.env, home = homedir()) {
	const configured = env.DSH_HOME?.trim();
	return join(configured === void 0 || configured === "" ? join(home, ".loomloom") : configured, "skills");
}
/** Locate the End Of Central Directory record by scanning backwards. */
function findEndOfCentralDirectory(archive) {
	const earliest = Math.max(0, archive.length - 65557);
	for (let offset = archive.length - 22; offset >= earliest; offset -= 1) if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
	return -1;
}
/**
* Decode a ZIP entry name. The UTF-8 flag wins; otherwise the bytes are
* treated as UTF-8 when they decode cleanly and latin1 when they do not.
*/
function decodeEntryName(raw, flags) {
	if ((flags & 2048) !== 0) return raw.toString("utf8");
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(raw);
	} catch {
		return raw.toString("latin1");
	}
}
/**
* Reject entry names that could escape the extraction root: absolute paths,
* drive letters, and any `.`/`..`/empty segment after normalizing separators.
*/
function assertSafeEntryName(name) {
	const normalized = name.replace(/\\/gu, "/");
	if (normalized.startsWith("/") || /^[a-zA-Z]:/u.test(normalized)) throw new LoomApiError(502, `skill package entry "${name}" uses an absolute path`);
	for (const segment of normalized.split("/")) if (segment === "" || segment === "." || segment === "..") throw new LoomApiError(502, `skill package entry "${name}" escapes the skill directory`);
}
/**
* Minimal ZIP reader covering the shapes the backend publishes: stored and
* deflate entries, no ZIP64. Everything is bounded so a hostile archive cannot
* exhaust memory.
*/
function readZipEntries(archive) {
	if (archive.length < 22) throw new LoomApiError(502, "skill package archive is not a valid ZIP file");
	const end = findEndOfCentralDirectory(archive);
	if (end < 0) throw new LoomApiError(502, "skill package archive is not a valid ZIP file");
	const entryCount = archive.readUInt16LE(end + 10);
	const centralOffset = archive.readUInt32LE(end + 16);
	if (entryCount === 65535 || centralOffset === 4294967295) throw new LoomApiError(502, "skill package archive uses ZIP64, which is not supported");
	const entries = [];
	let totalUncompressed = 0;
	let cursor = centralOffset;
	for (let index = 0; index < entryCount; index += 1) {
		if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) throw new LoomApiError(502, "skill package archive central directory is corrupt");
		const flags = archive.readUInt16LE(cursor + 8);
		const method = archive.readUInt16LE(cursor + 10);
		const compressedSize = archive.readUInt32LE(cursor + 20);
		const uncompressedSize = archive.readUInt32LE(cursor + 24);
		const nameLength = archive.readUInt16LE(cursor + 28);
		const extraLength = archive.readUInt16LE(cursor + 30);
		const commentLength = archive.readUInt16LE(cursor + 32);
		const localOffset = archive.readUInt32LE(cursor + 42);
		const nameStart = cursor + 46;
		if (nameStart + nameLength > archive.length) throw new LoomApiError(502, "skill package archive entry name is truncated");
		const name = decodeEntryName(archive.subarray(nameStart, nameStart + nameLength), flags);
		cursor = nameStart + nameLength + extraLength + commentLength;
		if (name.endsWith("/")) continue;
		assertSafeEntryName(name);
		if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new LoomApiError(502, `skill package entry "${name}" has a corrupt local header`);
		const localNameLength = archive.readUInt16LE(localOffset + 26);
		const localExtraLength = archive.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const dataEnd = dataStart + compressedSize;
		if (dataEnd > archive.length) throw new LoomApiError(502, `skill package entry "${name}" is truncated`);
		const raw = archive.subarray(dataStart, dataEnd);
		let data;
		if (method === 0) data = Buffer.from(raw);
		else if (method === 8) try {
			data = inflateRawSync(raw);
		} catch {
			throw new LoomApiError(502, `skill package entry "${name}" could not be decompressed`);
		}
		else throw new LoomApiError(502, `skill package entry "${name}" uses unsupported compression method ${method}`);
		if (uncompressedSize !== 0 && data.length !== uncompressedSize) throw new LoomApiError(502, `skill package entry "${name}" size does not match its header`);
		totalUncompressed += data.length;
		if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new LoomApiError(502, "skill package expands beyond the size limit");
		entries.push({
			name,
			data
		});
	}
	if (entries.length === 0) throw new LoomApiError(502, "skill package archive contains no files");
	return entries;
}
async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
/**
* Find an already-installed package for the same source whose recorded hash
* matches, so a repeat install can report `unchanged` instead of re-downloading.
*/
async function findInstalledSkillPackage(skillRoot, sourceRef, archiveHash) {
	const expected = normalizeArchiveHash(archiveHash);
	let dirents;
	try {
		dirents = await readdir(skillRoot, { withFileTypes: true });
	} catch {
		return;
	}
	for (const dirent of dirents) {
		if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
		const dir = join(skillRoot, dirent.name);
		let marker;
		try {
			marker = JSON.parse(await readFile(join(dir, MARKER_NAME), "utf8"));
		} catch {
			continue;
		}
		if (marker.schemaVersion !== 1 || marker.source !== sourceRef) continue;
		if (normalizeArchiveHash(String(marker.archiveHash)) !== expected) continue;
		return {
			installed: true,
			updated: false,
			unchanged: true,
			skillName: dirent.name,
			dir,
			archiveHash: expected
		};
	}
}
/**
* Verify, unpack and atomically install one skill package archive.
*
* The archive is staged inside `skillRoot` and then renamed into place, so a
* crash mid-install leaves either the previous version or nothing, never a
* half-written skill.
*/
async function installSkillPackage(options) {
	const { skillRoot, sourceRef, archive } = options;
	if (archive.length === 0) throw new LoomApiError(400, "skill package archive is empty");
	if (archive.length > MAX_ARCHIVE_BYTES) throw new LoomApiError(502, "skill package archive exceeds the 10 MiB limit");
	const actualHash = createHash("sha256").update(archive).digest("hex");
	const expectedHash = normalizeArchiveHash(options.archiveHash);
	if (expectedHash !== "" && expectedHash !== actualHash) throw new LoomApiError(502, "skill package archive does not match the published hash");
	const entries = readZipEntries(archive);
	const roots = new Set(entries.map((entry) => entry.name.replace(/\\/gu, "/").split("/")[0] ?? ""));
	if (roots.size !== 1) throw new LoomApiError(502, "skill package must contain exactly one top-level directory");
	const skillName = [...roots][0] ?? "";
	if (skillName === "" || !/^[A-Za-z0-9._-]{1,100}$/u.test(skillName)) throw new LoomApiError(502, `skill package top-level directory "${skillName}" is not a valid skill name`);
	const skillMd = entries.find((entry) => entry.name.replace(/\\/gu, "/") === `${skillName}/SKILL.md`);
	if (skillMd === void 0) throw new LoomApiError(502, `skill package must contain ${skillName}/SKILL.md`);
	if (skillMd.data.length > MAX_SKILL_MD_BYTES) throw new LoomApiError(502, "skill package SKILL.md exceeds the 500 KiB limit");
	if (!skillMd.data.toString("utf8").replace(/^\uFEFF/u, "").startsWith("---")) throw new LoomApiError(502, "skill package SKILL.md must start with frontmatter");
	await mkdir(skillRoot, { recursive: true });
	const stage = await mkdtemp(join(skillRoot, ".loomloom-skill-package-"));
	const stagedSkill = join(stage, skillName);
	try {
		for (const entry of entries) {
			const destination = join(stagedSkill, entry.name.replace(/\\/gu, "/").slice(skillName.length + 1));
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, entry.data, { mode: 420 });
		}
		const marker = {
			schemaVersion: 1,
			source: sourceRef,
			archiveHash: actualHash
		};
		await writeFile(join(stagedSkill, MARKER_NAME), `${JSON.stringify(marker)}\n`, { mode: 384 });
		const target = join(skillRoot, skillName);
		const hadPrevious = await exists(target);
		let backup;
		if (hadPrevious) {
			backup = `${target}.backup-${Date.now()}`;
			await rename(target, backup);
		}
		try {
			await rename(stagedSkill, target);
		} catch (cause) {
			if (backup !== void 0) await rename(backup, target).catch(() => void 0);
			throw cause;
		}
		if (backup !== void 0) await rm(backup, {
			recursive: true,
			force: true
		});
		return {
			installed: true,
			updated: hadPrevious,
			unchanged: false,
			skillName,
			dir: target,
			archiveHash: actualHash
		};
	} finally {
		await rm(stage, {
			recursive: true,
			force: true
		});
	}
}
/**
* Remove an installed skill directory. Only directories carrying a valid
* marker are removed, so an unrelated folder in the skill root is never lost.
*/
async function uninstallSkillPackage(skillRoot, skillName) {
	if (!/^[A-Za-z0-9._-]{1,100}$/u.test(skillName)) throw new LoomApiError(400, "invalid skill name");
	const dir = join(skillRoot, skillName);
	let marker;
	try {
		marker = JSON.parse(await readFile(join(dir, MARKER_NAME), "utf8"));
	} catch {
		return false;
	}
	if (marker.schemaVersion !== 1) return false;
	await rm(dir, {
		recursive: true,
		force: true
	});
	return true;
}
/** List installed packages recorded in one skill root. */
async function listInstalledSkillPackages(skillRoot) {
	let dirents;
	try {
		dirents = await readdir(skillRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	const installed = [];
	for (const dirent of dirents) {
		if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
		try {
			const marker = JSON.parse(await readFile(join(skillRoot, dirent.name, MARKER_NAME), "utf8"));
			if (marker.schemaVersion !== 1) continue;
			installed.push({
				...marker,
				skillName: dirent.name,
				dir: join(skillRoot, dirent.name)
			});
		} catch {
			continue;
		}
	}
	return installed;
}
//#endregion
//#region src/market/routes.ts
const PREFIX = "/api/loomloom";
const ID_PATTERN$1 = /^[A-Za-z0-9._-]{1,200}$/;
const LOGIN_SESSION_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const CONFIRMATION_TOKEN_PATTERN = /^[A-Za-z0-9-]{36}$/;
const MAX_JSON_REQUEST_BYTES = 512 * 1024;
const MAX_WORKBOOK_BYTES = 16 * 1024 * 1024;
const MAX_WORKBOOK_REQUEST_BYTES = Math.ceil(MAX_WORKBOOK_BYTES * 4 / 3) + 64 * 1024;
const QUOTE_TTL_MS = 10 * 6e4;
const MAX_QUOTE_DRAFTS = 100;
var QuoteDraftStore = class {
	#drafts = /* @__PURE__ */ new Map();
	create(kind, listingId, fingerprint) {
		this.prune();
		if (this.#drafts.size >= MAX_QUOTE_DRAFTS) {
			const oldest = this.#drafts.keys().next().value;
			if (oldest !== void 0) this.#drafts.delete(oldest);
		}
		const token = randomUUID();
		this.#drafts.set(token, {
			kind,
			listingId,
			fingerprint,
			expiresAt: Date.now() + QUOTE_TTL_MS
		});
		return token;
	}
	require(token, kind, listingId, fingerprint, clientRequestId) {
		this.prune();
		if (typeof token !== "string" || !CONFIRMATION_TOKEN_PATTERN.test(token)) throw new LoomApiError(403, "execution requires a valid quote confirmation");
		const draft = this.#drafts.get(token);
		if (draft === void 0 || draft.kind !== kind || draft.listingId !== listingId || draft.fingerprint !== fingerprint) throw new LoomApiError(403, "quote confirmation is unavailable or does not match the execution input");
		if (draft.clientRequestId !== void 0 && draft.clientRequestId !== clientRequestId) throw new LoomApiError(409, "an ambiguous retry must reuse the original clientRequestId");
		draft.clientRequestId = clientRequestId;
		return token;
	}
	consume(token) {
		this.#drafts.delete(token);
	}
	prune() {
		const now = Date.now();
		for (const [token, draft] of this.#drafts) if (draft.expiresAt <= now) this.#drafts.delete(token);
	}
};
function inputFingerprint(listingId, value) {
	return createHash("sha256").update(listingId).update("\0").update(JSON.stringify(value)).digest("hex");
}
function withConfirmationToken(value, confirmationToken) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? {
		...value,
		confirmationToken
	} : {
		data: value,
		confirmationToken
	};
}
/**
* File inputs publish `value_type: asset_ref`, which is satisfied by uploading
* the bytes and submitting the returned `inputAssetId`. Base64 inflates by about
* a third, so the request ceiling is set above the decoded file ceiling rather
* than reusing the ordinary JSON body cap.
*/
const MAX_INPUT_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_ASSET_REQUEST_BYTES = 6 * 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
const MEDIA_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+$/u;
function sendJson$1(res, status, value) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-content-type-options", "nosniff");
	res.end(JSON.stringify(value));
}
/**
* Stream a downloaded workbook back to the caller. Binary payloads cross the
* upstream boundary as base64 (the CLI's `[]byte` JSON encoding), so the route
* decodes once and sets a download filename the browser can honour.
*/
function sendBinary(res, payload) {
	res.statusCode = 200;
	res.setHeader("content-type", payload.contentType);
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-content-type-options", "nosniff");
	res.setHeader("content-disposition", `attachment; filename="${sanitizeDownloadFilename(payload.filename) ?? "download.xlsx"}"`);
	res.end(Buffer.from(payload.base64, "base64"));
}
function sameAuthority$1(req, port) {
	const host = req.headers.host?.toLowerCase();
	return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
function apiFailure(res, cause) {
	if (cause instanceof LoomApiError) sendJson$1(res, cause.status >= 400 && cause.status < 600 ? cause.status : 502, { error: cause.message });
	else sendJson$1(res, 400, { error: cause instanceof Error ? cause.message : "invalid request" });
}
function credentialFailure(res) {
	sendJson$1(res, 503, { error: "loomloom credential status is unavailable" });
}
async function requestBody(req, maxBytes = MAX_JSON_REQUEST_BYTES) {
	if (!/^application\/json(?:\s*;|$)/iu.test(req.headers["content-type"] ?? "")) throw new LoomApiError(415, "content-type must be application/json");
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		const bytes = Buffer.from(chunk);
		size += bytes.byteLength;
		if (size > maxBytes) throw new LoomApiError(413, "request body is too large");
		chunks.push(bytes);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
		return value;
	} catch {
		throw new LoomApiError(400, "request body must be a JSON object");
	}
}
function workbookPayload(body) {
	const filename = typeof body.filename === "string" ? body.filename.trim() : "";
	const content = typeof body.content === "string" ? body.content.trim() : "";
	if (filename === "" || content === "") throw new LoomApiError(400, "filename and content are required");
	if (filename.length > 255) throw new LoomApiError(400, "filename is too long");
	if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(content)) throw new LoomApiError(400, "content must be valid base64");
	if (Buffer.byteLength(content, "base64") > MAX_WORKBOOK_BYTES) throw new LoomApiError(413, "workbook is too large");
	return {
		filename,
		content
	};
}
/**
* Forward a filled workbook to one upstream workbook action. The client sends
* `{ filename, content }` where content is base64 bytes (the same encoding the
* upstream expects from the Go CLI), plus a `listingId` query parameter. The
* paid run action additionally requires an explicit confirmation and a
* stable idempotency key.
*/
async function forwardWorkbookAction(req, res, api, action, mode, quoteDrafts) {
	await forwardWorkbookTo(req, res, api, (id) => `/marketListings/${encodeURIComponent(id)}${action}`, "listingId", mode, quoteDrafts);
}
/** The official-template variant of {@link forwardWorkbookAction}. */
async function forwardTemplateWorkbookAction(req, res, api, action) {
	await forwardWorkbookTo(req, res, api, (id) => `/officialTemplates/${encodeURIComponent(id)}${action}`, "templateId", "prepare");
}
async function forwardWorkbookTo(req, res, api, pathFor, idParam, mode, quoteDrafts) {
	try {
		const id = new URL(req.url ?? "/", "http://localhost").searchParams.get(idParam);
		if (id === null || !ID_PATTERN$1.test(id)) throw new LoomApiError(400, `invalid ${idParam}`);
		const body = await requestBody(req, MAX_WORKBOOK_REQUEST_BYTES);
		const { filename, content } = workbookPayload(body);
		const payload = {
			filename,
			content
		};
		const fingerprint = inputFingerprint(id, payload);
		if (mode === "execute") {
			if (quoteDrafts === void 0) throw new LoomApiError(503, "workbook quote confirmation is unavailable");
			if (body.confirm !== true) throw new LoomApiError(403, "workbook execution requires explicit confirmation");
			if (typeof body.clientRequestId !== "string" || !CLIENT_REQUEST_ID_PATTERN.test(body.clientRequestId)) throw new LoomApiError(400, "workbook execution requires a valid clientRequestId");
			const confirmationToken = quoteDrafts.require(body.confirmationToken, "workbook", id, fingerprint, body.clientRequestId);
			payload.confirm = true;
			payload.clientRequestId = body.clientRequestId;
			const response = await api.request(pathFor(id), {
				method: "POST",
				body: JSON.stringify(payload)
			});
			quoteDrafts.consume(confirmationToken);
			sendJson$1(res, 200, response);
			return;
		}
		const response = await api.request(pathFor(id), {
			method: "POST",
			body: JSON.stringify(payload)
		});
		if (mode === "quote") {
			if (quoteDrafts === void 0) throw new LoomApiError(503, "workbook quote confirmation is unavailable");
			sendJson$1(res, 200, withConfirmationToken(response, quoteDrafts.create("workbook", id, fingerprint)));
			return;
		}
		sendJson$1(res, 200, response);
	} catch (cause) {
		apiFailure(res, cause);
	}
}
function registerLoomRoutes(ctx, api, readCredentialStatus, browserLogin, clearCredential, readBootstrap, readAccount, extras = {}) {
	const port = ctx.webServer.port;
	const quoteDrafts = new QuoteDraftStore();
	const register = (path, handler) => ctx.webServer.register({
		kind: "exact",
		path,
		handler
	});
	const requireOrigin = (req, res) => {
		if (!sameAuthority$1(req, port)) {
			sendJson$1(res, 403, { error: "loomloom request authority rejected" });
			return false;
		}
		if (req.method === "GET" || req.method === "HEAD") return true;
		const host = req.headers.host?.toLowerCase();
		if (host !== void 0 && req.headers.origin === `http://${host}`) return true;
		sendJson$1(res, 403, { error: "loomloom request authority rejected" });
		return false;
	};
	const routes = [
		register(`${PREFIX}/health`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			sendJson$1(res, 200, { ok: true });
		}),
		register(`${PREFIX}/credentials`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				sendJson$1(res, 200, await readCredentialStatus());
			} catch {
				credentialFailure(res);
			}
		}),
		register(`${PREFIX}/bootstrap`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				if (readBootstrap !== void 0) {
					sendJson$1(res, 200, await readBootstrap());
					return;
				}
				sendJson$1(res, 200, {
					credential: await readCredentialStatus(),
					loom: "unknown",
					router: "unknown",
					model: {
						provider: "shengsuanyun",
						ready: false
					}
				});
			} catch {
				credentialFailure(res);
			}
		}),
		register(`${PREFIX}/account`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			if (readAccount === void 0) {
				sendJson$1(res, 503, { error: "loomloom account is unavailable" });
				return;
			}
			try {
				sendJson$1(res, 200, await readAccount());
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/credentials/logout`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			if (clearCredential === void 0) {
				sendJson$1(res, 503, { error: "loomloom logout is unavailable" });
				return;
			}
			try {
				await clearCredential();
				sendJson$1(res, 200, { configured: false });
			} catch {
				credentialFailure(res);
			}
		}),
		register(`${PREFIX}/login/start`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			if (browserLogin === void 0) {
				sendJson$1(res, 503, { error: "loomloom browser login is unavailable" });
				return;
			}
			try {
				sendJson$1(res, 200, await browserLogin.start());
			} catch {
				sendJson$1(res, 503, { error: "loomloom browser login is unavailable" });
			}
		}),
		register(`${PREFIX}/login/status`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			if (browserLogin === void 0) {
				sendJson$1(res, 503, { error: "loomloom browser login is unavailable" });
				return;
			}
			const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("sessionId");
			if (sessionId === null || !LOGIN_SESSION_PATTERN.test(sessionId)) {
				sendJson$1(res, 400, { error: "invalid login session" });
				return;
			}
			const status = browserLogin.status(sessionId);
			if (status === void 0) {
				sendJson$1(res, 404, { error: "login session not found" });
				return;
			}
			sendJson$1(res, 200, status);
		}),
		register(`${PREFIX}/login/cancel`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			if (browserLogin === void 0) {
				sendJson$1(res, 503, { error: "loomloom browser login is unavailable" });
				return;
			}
			const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("sessionId");
			if (sessionId === null || !LOGIN_SESSION_PATTERN.test(sessionId)) {
				sendJson$1(res, 400, { error: "invalid login session" });
				return;
			}
			await browserLogin.cancel(sessionId);
			sendJson$1(res, 200, { cancelled: true });
		}),
		register(`${PREFIX}/storefront`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			if (extras.storefront === void 0) {
				sendJson$1(res, 503, { error: "loomloom storefront is unavailable" });
				return;
			}
			const force = new URL(req.url ?? "/", "http://localhost").searchParams.get("refresh") === "1";
			try {
				const result = await extras.storefront.read(force);
				if (result.error !== void 0) ctx.logger.warn(`loomloom: storefront refresh failed: ${result.error}`);
				sendJson$1(res, 200, {
					...result,
					source: extras.storefrontSource ?? "none"
				});
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/market`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			const query = new URL(req.url ?? "/", "http://localhost").searchParams;
			const rawPageSize = Number(query.get("pageSize") ?? "100");
			if (!Number.isInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 100) {
				sendJson$1(res, 400, { error: "pageSize must be an integer from 1 to 100" });
				return;
			}
			const upstream = new URLSearchParams({ pageSize: String(rawPageSize) });
			const pageToken = query.get("pageToken");
			if (pageToken !== null && pageToken !== "") upstream.set("pageToken", pageToken);
			const keyword = query.get("keyword");
			if (keyword !== null && keyword !== "") upstream.set("keyword", keyword);
			try {
				sendJson$1(res, 200, await api.request(`/marketListings?${upstream.toString()}`));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/market/skillbot`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			const listingId = new URL(req.url ?? "/", "http://localhost").searchParams.get("listingId");
			if (listingId === null || !ID_PATTERN$1.test(listingId)) {
				sendJson$1(res, 400, { error: "invalid listingId" });
				return;
			}
			try {
				sendJson$1(res, 200, await api.request(`/marketListings/${encodeURIComponent(listingId)}`));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/inputAssets`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			try {
				const body = await requestBody(req, MAX_INPUT_ASSET_REQUEST_BYTES);
				const filename = typeof body.filename === "string" ? body.filename.trim() : "";
				const contentType = typeof body.contentType === "string" ? body.contentType.trim() : "";
				const content = typeof body.content === "string" ? body.content.trim() : "";
				if (filename === "" || filename.length > 255) throw new LoomApiError(400, "filename must be a non-empty name of at most 255 characters");
				if (!MEDIA_TYPE_PATTERN.test(contentType)) throw new LoomApiError(400, "contentType must be a media type");
				if (content === "" || content.length % 4 !== 0 || !BASE64_PATTERN.test(content)) throw new LoomApiError(400, "content must be base64 data");
				if (Buffer.from(content, "base64").byteLength > MAX_INPUT_ASSET_BYTES) throw new LoomApiError(413, "input asset exceeds the upload limit");
				sendJson$1(res, 200, await api.request("/inputAssets:upload", {
					method: "POST",
					body: JSON.stringify({
						content,
						contentType,
						filename
					})
				}));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/market/skillbot/quote`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			try {
				const listingId = new URL(req.url ?? "/", "http://localhost").searchParams.get("listingId");
				if (listingId === null || !ID_PATTERN$1.test(listingId)) throw new LoomApiError(400, "invalid listingId");
				const inputRows = (await requestBody(req)).inputRows;
				if (!Array.isArray(inputRows) || inputRows.length < 1 || inputRows.length > 100) throw new LoomApiError(400, "inputRows must contain 1-100 rows");
				sendJson$1(res, 200, withConfirmationToken(await api.request(`/marketListings/${encodeURIComponent(listingId)}:quote`, {
					method: "POST",
					body: JSON.stringify({ inputRows })
				}), quoteDrafts.create("rows", listingId, inputFingerprint(listingId, inputRows))));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/market/skillbot/execute`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			try {
				const listingId = new URL(req.url ?? "/", "http://localhost").searchParams.get("listingId");
				if (listingId === null || !ID_PATTERN$1.test(listingId)) throw new LoomApiError(400, "invalid listingId");
				const body = await requestBody(req);
				if (body.confirm !== true) throw new LoomApiError(403, "execution requires explicit confirmation");
				const inputRows = body.inputRows;
				if (!Array.isArray(inputRows) || inputRows.length < 1 || inputRows.length > 100) throw new LoomApiError(400, "inputRows must contain 1-100 rows");
				if (typeof body.clientRequestId !== "string" || !CLIENT_REQUEST_ID_PATTERN.test(body.clientRequestId)) throw new LoomApiError(400, "execution requires a valid clientRequestId");
				const confirmationToken = quoteDrafts.require(body.confirmationToken, "rows", listingId, inputFingerprint(listingId, inputRows), body.clientRequestId);
				const response = await api.request(`/marketListings/${encodeURIComponent(listingId)}:execute`, {
					method: "POST",
					body: JSON.stringify({
						inputRows,
						clientRequestId: body.clientRequestId,
						confirm: true
					})
				});
				quoteDrafts.consume(confirmationToken);
				sendJson$1(res, 200, response);
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/runs`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				sendJson$1(res, 200, await api.request("/users/me/runs?pageSize=50"));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/runs/status`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			const runId = new URL(req.url ?? "/", "http://localhost").searchParams.get("runId");
			if (runId === null || !ID_PATTERN$1.test(runId)) {
				sendJson$1(res, 400, { error: "invalid runId" });
				return;
			}
			try {
				sendJson$1(res, 200, await api.request(`/users/me/runs/${encodeURIComponent(runId)}`));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/balance`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				sendJson$1(res, 200, await api.request("/users/me/balance"));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/creator/listings`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				sendJson$1(res, 200, await api.request("/creators/me/marketListings?pageSize=100"));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/creator/transactions`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				sendJson$1(res, 200, await api.request("/creators/me/marketTransactions?pageSize=100"));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/creator/earnings`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			const limit = new URL(req.url ?? "/", "http://localhost").searchParams.get("pageSize") ?? "100";
			if (!/^\d{1,4}$/u.test(limit)) {
				sendJson$1(res, 400, { error: "invalid pageSize" });
				return;
			}
			try {
				sendJson$1(res, 200, await api.request(`/creators/me/earnings?pageSize=${limit}`));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/templates`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				sendJson$1(res, 200, await api.request("/officialTemplates"));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/templates/schema`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			const templateId = new URL(req.url ?? "/", "http://localhost").searchParams.get("templateId");
			if (templateId === null || !ID_PATTERN$1.test(templateId)) {
				sendJson$1(res, 400, { error: "invalid templateId" });
				return;
			}
			try {
				sendJson$1(res, 200, await api.request(`/officialTemplates/${encodeURIComponent(templateId)}/schema`));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/my-templates`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			try {
				sendJson$1(res, 200, await api.request("/users/me/templates?pageSize=50"));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/templates/workbook/validate`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			await forwardTemplateWorkbookAction(req, res, api, ":validateWorkbook");
		}),
		register(`${PREFIX}/templates/workbook/precheck`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			await forwardTemplateWorkbookAction(req, res, api, ":precheckWorkbook");
		}),
		register(`${PREFIX}/market/workbook`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			const listingId = new URL(req.url ?? "/", "http://localhost").searchParams.get("listingId");
			if (listingId === null || !ID_PATTERN$1.test(listingId)) {
				sendJson$1(res, 400, { error: "invalid listingId" });
				return;
			}
			try {
				const workbook = await api.requestBinary(`/marketListings/${encodeURIComponent(listingId)}/workbook`);
				sendBinary(res, {
					...workbook,
					filename: workbook.filename ?? `${listingId}.xlsx`
				});
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/templates/workbook`, async (req, res) => {
			if (req.method !== "GET" || !requireOrigin(req, res)) return;
			const templateId = new URL(req.url ?? "/", "http://localhost").searchParams.get("templateId");
			if (templateId === null || !ID_PATTERN$1.test(templateId)) {
				sendJson$1(res, 400, { error: "invalid templateId" });
				return;
			}
			try {
				const workbook = await api.requestBinary(`/officialTemplates/${encodeURIComponent(templateId)}/workbook`);
				sendBinary(res, {
					...workbook,
					filename: workbook.filename ?? `${templateId}.xlsx`
				});
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/orchestration-input`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			try {
				const body = await requestBody(req);
				const filename = typeof body.filename === "string" ? body.filename.trim() : "";
				const content = typeof body.content === "string" ? body.content : "";
				if (filename === "" || content === "") throw new LoomApiError(400, "filename and content are required");
				sendJson$1(res, 200, await api.request("/orchestrationInputs:upload", {
					method: "POST",
					body: JSON.stringify({
						filename,
						content: Buffer.from(content, "utf8").toString("base64")
					})
				}));
			} catch (cause) {
				apiFailure(res, cause);
			}
		}),
		register(`${PREFIX}/market/workbook/validate`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			await forwardWorkbookAction(req, res, api, ":validateWorkbook", "prepare", quoteDrafts);
		}),
		register(`${PREFIX}/market/workbook/quote`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			await forwardWorkbookAction(req, res, api, ":quoteWorkbook", "quote", quoteDrafts);
		}),
		register(`${PREFIX}/market/workbook/run`, async (req, res) => {
			if (req.method !== "POST" || !requireOrigin(req, res)) return;
			await forwardWorkbookAction(req, res, api, ":executeWorkbook", "execute", quoteDrafts);
		}),
		...extras.skillbots !== void 0 && extras.skillRoot !== void 0 ? [
			register(`${PREFIX}/skill-package`, async (req, res) => {
				if (req.method !== "GET" || !requireOrigin(req, res)) return;
				const listingId = new URL(req.url ?? "/", "http://localhost").searchParams.get("listingId");
				if (listingId === null || !ID_PATTERN$1.test(listingId)) {
					sendJson$1(res, 400, { error: "invalid listingId" });
					return;
				}
				try {
					sendJson$1(res, 200, await extras.skillbots.getSkillPackage(listingId));
				} catch (cause) {
					apiFailure(res, cause);
				}
			}),
			register(`${PREFIX}/skill-package/archive`, async (req, res) => {
				if (req.method !== "GET" || !requireOrigin(req, res)) return;
				const listingId = new URL(req.url ?? "/", "http://localhost").searchParams.get("listingId");
				if (listingId === null || !ID_PATTERN$1.test(listingId)) {
					sendJson$1(res, 400, { error: "invalid listingId" });
					return;
				}
				try {
					const { archive } = await extras.skillbots.downloadSkillPackage(listingId);
					sendBinary(res, {
						base64: archive.toString("base64"),
						contentType: "application/zip",
						filename: `${listingId}.zip`
					});
				} catch (cause) {
					apiFailure(res, cause);
				}
			}),
			register(`${PREFIX}/skill-package/install`, async (req, res) => {
				if (req.method !== "POST" || !requireOrigin(req, res)) return;
				const listingId = new URL(req.url ?? "/", "http://localhost").searchParams.get("listingId");
				if (listingId === null || !ID_PATTERN$1.test(listingId)) {
					sendJson$1(res, 400, { error: "invalid listingId" });
					return;
				}
				try {
					sendJson$1(res, 200, await extras.skillbots.installSkill(listingId, extras.skillRoot()));
				} catch (cause) {
					apiFailure(res, cause);
				}
			}),
			register(`${PREFIX}/skill-package/uninstall`, async (req, res) => {
				if (req.method !== "POST" || !requireOrigin(req, res)) return;
				try {
					const body = await requestBody(req);
					const skillName = typeof body.skillName === "string" ? body.skillName.trim() : "";
					if (skillName === "") throw new LoomApiError(400, "skillName is required");
					sendJson$1(res, 200, { removed: await uninstallSkillPackage(extras.skillRoot(), skillName) });
				} catch (cause) {
					apiFailure(res, cause);
				}
			}),
			register(`${PREFIX}/skill-package/installed`, async (req, res) => {
				if (req.method !== "GET" || !requireOrigin(req, res)) return;
				try {
					sendJson$1(res, 200, { items: await listInstalledSkillPackages(extras.skillRoot()) });
				} catch (cause) {
					apiFailure(res, cause);
				}
			})
		] : []
	];
	return () => routes.forEach((dispose) => dispose());
}
/** Nesting levels a single object is expanded into dot paths. */
const MAX_DEPTH = 2;
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** One value as a short string; containers become a shape hint rather than exploding. */
function summarize(value) {
	if (value === null) return "null";
	if (value === void 0) return "";
	if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${String(value.length)} items]`;
	if (isRecord$1(value)) return Object.keys(value).length === 0 ? "{}" : "{…}";
	if (typeof value === "object") return String(value);
	return String(value);
}
/** Collapses whitespace, escapes the table delimiter, and elides long values. */
function cell(value, maxChars) {
	const escaped = summarize(value).replace(/\s+/gu, " ").trim().replace(/\|/gu, "\\|");
	return escaped.length > maxChars ? `${escaped.slice(0, maxChars - 1)}…` : escaped;
}
/** Column order: first appearance across rows, so the payload's own order wins. */
function columnsOf(rows, maxColumns) {
	const columns = [];
	for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
	return columns.slice(0, maxColumns);
}
/** Flattens one object into dot-path leaves, expanding at most {@link MAX_DEPTH} levels. */
function leaves(value, prefix, depth, out) {
	if (depth >= MAX_DEPTH || !isRecord$1(value)) {
		out.push([prefix, value]);
		return;
	}
	const entries = Object.entries(value);
	if (entries.length === 0) {
		out.push([prefix, value]);
		return;
	}
	for (const [key, child] of entries) leaves(child, prefix === "" ? key : `${prefix}.${key}`, depth + 1, out);
}
function table$1(value, options) {
	const maxRows = options.maxRows ?? 20;
	const maxColumns = options.maxColumns ?? 8;
	const maxChars = options.maxCellChars ?? 120;
	const columns = columnsOf(value, maxColumns);
	if (columns.length === 0) return {
		kind: "empty",
		reason: "no-fields"
	};
	const shown = value.slice(0, maxRows);
	const totalColumns = new Set(value.flatMap((row) => Object.keys(row))).size;
	return {
		kind: "table",
		columns: columns.map((column) => cell(column, maxChars)),
		rows: shown.map((row) => columns.map((column) => cell(row[column], maxChars))),
		totalRows: value.length,
		omittedColumns: Math.max(0, totalColumns - columns.length)
	};
}
function fields(value, options) {
	const maxChars = options.maxCellChars ?? 120;
	const pairs = [];
	for (const [key, child] of Object.entries(value)) leaves(child, key, 1, pairs);
	if (pairs.length === 0) return {
		kind: "empty",
		reason: "empty-object"
	};
	return {
		kind: "fields",
		rows: pairs.map(([key, child]) => [cell(key, maxChars), cell(child, maxChars)])
	};
}
/**
* Describes one result value.
*
* Shape decides the form: a record array becomes a table, a single record becomes
* a field/value list with dotted paths, a scalar array becomes one column, and
* anything else falls back to text.
* @param value - the parsed payload.
* @param options - caps applied to rows, columns and cell length.
* @returns the display-ready view.
*/
function describePayload(value, options = {}) {
	const maxChars = options.maxCellChars ?? 120;
	if (value === null || value === void 0) return {
		kind: "empty",
		reason: "no-result"
	};
	if (Array.isArray(value)) {
		if (value.length === 0) return {
			kind: "empty",
			reason: "empty-list"
		};
		return value.every(isRecord$1) ? table$1(value, options) : {
			kind: "scalars",
			rows: value.map((entry) => cell(entry, maxChars))
		};
	}
	if (isRecord$1(value)) return fields(value, options);
	return {
		kind: "text",
		text: String(value)
	};
}
/** The marker a renderer draws for a payload that has nothing to show. */
function emptyMarker(reason) {
	switch (reason) {
		case "no-result": return "_(no result)_";
		case "empty-list": return "_(empty list)_";
		case "empty-object": return "_(empty object)_";
		case "no-fields": return "_(no fields)_";
	}
}
//#endregion
//#region src/market/result-presentation.ts
/**
* Renders a run's result value as the Markdown a DSH conversation already draws.
*
* SkillBot outputs are JSON — a batch of generated rows, a structured brief, a
* per-row status — and dropping that into a tool card as raw text makes the one
* artefact the user paid for the hardest thing on screen to read. The
* conversation renders GFM tables (`micromark-extension-gfm-table` is part of the
* client renderer), so a table is reachable through the ordinary text content
* block: no new block type, no upstream change, and a plain fallback when the
* payload is not tabular.
*
* The shape decision itself lives in `payload-view.ts`, shared with the client's
* result card; this module only turns that view into Markdown.
*/
/**
* Character budget for one artifact payload.
*
* The value is handed to the model as well as drawn on the card, so an
* unbounded output would land in the conversation's context. The Host already
* caps an upstream body at 2 MB, which is far too much for a context window;
* this is the presentation budget. Truncation stays visible in the text so a
* caller never mistakes a cut payload for a complete one.
*/
const MAX_ARTIFACT_TEXT_CHARS = 16e3;
const TRUNCATION_MARKER = "\n…[truncated]";
/** Number of artifacts whose payload is drawn before the rest are only listed. */
const DEFAULT_MAX_ARTIFACTS = 3;
/**
* Parses an artifact's inline text when it is a JSON object or array.
*
* Scalar JSON (`42`, `"done"`) is deliberately not treated as a payload: the raw
* text is already the best presentation of it, and refusing it keeps callers from
* rendering a one-cell table.
*/
function parseInlineJson(text) {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return void 0;
	try {
		const parsed = JSON.parse(trimmed);
		return isRecord(parsed) || Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function table(header, body) {
	return [
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...body.map((cells) => `| ${cells.join(" | ")} |`)
	].join("\n");
}
/** One table view plus the elision notes a reader must see. */
function tableMarkdown(view) {
	const rendered = table(view.columns, view.rows);
	const notes = [];
	const shown = view.rows.length;
	if (view.totalRows > shown) notes.push(`showing ${String(shown)} of ${String(view.totalRows)} rows`);
	if (view.omittedColumns > 0) notes.push(`${String(view.omittedColumns)} more column(s) omitted`);
	return [rendered, ...notes.map((note) => `_${note}_`)].join("\n\n");
}
/**
* Renders one result value as Markdown.
*
* Shape decides the form: a record array becomes a table, a single record becomes
* a field/value table with dotted paths, a scalar array becomes a one-column
* table, and anything else falls back to a fenced block so a caller never has to
* special-case a payload it did not expect.
*/
function jsonToMarkdown(value, options = {}) {
	const view = describePayload(value, options);
	switch (view.kind) {
		case "table": return tableMarkdown(view);
		case "fields": return table(["field", "value"], view.rows);
		case "scalars": return table(["value"], view.rows.map((row) => [row]));
		case "text": return `\`\`\`\n${view.text}\n\`\`\``;
		case "empty": return emptyMarker(view.reason);
	}
}
/** Bounds one artifact payload, marking the cut so a truncated result is never read as complete. */
function capArtifactText(text, budget = MAX_ARTIFACT_TEXT_CHARS) {
	return text.length <= budget ? text : `${text.slice(0, budget)}${TRUNCATION_MARKER}`;
}
function fenced(text) {
	return `\`\`\`\n${text.replace(/```/gu, "`​``")}\n\`\`\``;
}
/**
* Draws a run's output artifacts.
*
* Each artifact is titled by its label, its JSON payload becomes a table, its
* non-JSON payload becomes a fenced block, and a download link follows whenever
* the upstream published one. Only the first few payloads are drawn: a run can
* return many artifacts and the card is not the place to read all of them.
*/
function renderArtifacts(artifacts, options = {}) {
	if (artifacts.length === 0) return "_(no output artifacts)_";
	const maxArtifacts = options.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS;
	const shown = artifacts.slice(0, maxArtifacts);
	const blocks = shown.map((artifact) => {
		const parts = [`**${artifact.label}**`];
		if (artifact.inlineText !== void 0 && artifact.inlineText.trim() !== "") {
			const parsed = parseInlineJson(artifact.inlineText);
			parts.push(parsed === void 0 ? fenced(artifact.inlineText) : jsonToMarkdown(parsed, options));
		}
		if (artifact.accessUrl !== void 0) parts.push(`[${artifact.mimeType ?? "download"}](${artifact.accessUrl})`);
		return parts.join("\n\n");
	});
	if (artifacts.length > shown.length) blocks.push(`_${String(artifacts.length - shown.length)} more artifact(s) not shown_`);
	return blocks.join("\n\n");
}
//#endregion
//#region src/market/skillbots.ts
const MAX_INPUT_ROWS = 100;
const DRAFT_TTL_MS = 10 * 6e4;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
/** Upstream monetary unit system: 10,000,000 raw API units equal one currency unit. */
const RAW_UNITS_PER_CURRENCY = 1e7;
const RAW_UNITS_PER_CURRENCY_BIGINT = 10000000n;
const MAX_MARKET_PAGES = 20;
const MAX_MARKET_LISTINGS = MAX_MARKET_PAGES * 100;
/**
* Run statuses that mark a run as no longer progressing on the server. A run
* entering any of these states is safe to stop polling; the caller can still
* request a final result read.
*/
const TERMINAL_RUN_STATUSES = /* @__PURE__ */ new Set([
	"completed",
	"succeeded",
	"success",
	"failed",
	"error",
	"errored",
	"cancelled",
	"canceled",
	"partial_failed",
	"partially_failed"
]);
const DEFAULT_POLL_INITIAL_MS = 1500;
const DEFAULT_POLL_MAX_MS = 5e3;
const DEFAULT_POLL_JITTER = .2;
const DEFAULT_POLL_MAX_WAIT_MS = 5 * 6e4;
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function text$1(value) {
	return typeof value === "string" ? value.trim() : "";
}
function pickText(value, keys) {
	for (const key of keys) {
		const candidate = text$1(value[key]);
		if (candidate !== "") return candidate;
	}
	return "";
}
/** Reads the upstream market page cursor, honouring both nested shapes. */
function nextPageToken(value) {
	const data = asRecord(value.data);
	return pickText(value, ["nextPageToken", "next_page_token"]) || pickText(data, ["nextPageToken", "next_page_token"]);
}
/**
* Local keyword matching over the full dataset. Terms are split on
* whitespace and matched case-insensitively against title, description and
* id; listings with any hit are kept, ordered by hit count (most relevant
* first). A non-ASCII keyword needs no tokenization to match.
*/
function matchKeyword(listings, keyword) {
	const terms = keyword.trim().split(/\s+/u).filter((term) => term !== "");
	if (terms.length === 0) return listings;
	const normalized = terms.map((term) => term.toLocaleLowerCase());
	const matched = listings.map((listing) => {
		const haystack = `${listing.name} ${listing.description} ${listing.id}`.toLocaleLowerCase();
		return {
			listing,
			hits: normalized.filter((term) => haystack.includes(term)).length
		};
	}).filter((entry) => entry.hits > 0);
	matched.sort((left, right) => right.hits - left.hits);
	return matched.map((entry) => entry.listing);
}
function fixedFee(value) {
	return money$1(value, "taskFixedFee", "taskFixedFeeT", text$1(value.currency))?.amount;
}
function listingVersion(value) {
	const version = text$1(value.listingVersionId);
	return version === "" ? void 0 : version;
}
function summary(value) {
	const id = text$1(value.id);
	if (!ID_PATTERN.test(id)) throw new LoomApiError(502, "loomloom returned a listing without a valid id");
	const name = text$1(value.displayName) || id;
	const description = text$1(value.description);
	const versionId = listingVersion(value);
	const fee = fixedFee(value);
	return {
		id,
		name,
		description,
		available: text$1(value.executionAvailabilityStatus) === "available",
		...fee === void 0 ? {} : { fixedFee: fee },
		...versionId === void 0 ? {} : { versionId }
	};
}
function parseFields(value) {
	const snapshot = value.inputSchemaSnapshot;
	let schema = {};
	if (typeof snapshot === "string" && snapshot.trim() !== "") try {
		schema = asRecord(JSON.parse(snapshot));
	} catch {
		throw new LoomApiError(502, "loomloom returned an invalid input schema");
	}
	else if (typeof snapshot === "object" && snapshot !== null) schema = asRecord(snapshot);
	return (Array.isArray(schema.fields) ? schema.fields : []).map((field, index) => {
		const record = asRecord(field);
		const key = pickText(record, [
			"key",
			"name",
			"fieldKey"
		]);
		if (!ID_PATTERN.test(key)) throw new LoomApiError(502, `loomloom input schema field ${index + 1} is invalid`);
		const enums = record.enum_values ?? record.enumValues;
		const enumValues = Array.isArray(enums) ? enums.filter((item) => typeof item === "string") : void 0;
		return {
			key,
			label: pickText(record, [
				"label",
				"title",
				"displayName"
			]) || key,
			required: record.required === true || record.isRequired === true,
			valueType: pickText(record, [
				"value_type",
				"valueType",
				"type"
			]) || "string",
			...pickText(record, [
				"description",
				"desc",
				"inputHint",
				"help"
			]) === "" ? {} : { description: pickText(record, [
				"description",
				"desc",
				"inputHint",
				"help"
			]) },
			...enumValues === void 0 || enumValues.length === 0 ? {} : { enumValues }
		};
	});
}
function applyJitter(delayMs, jitterRatio) {
	if (delayMs <= 0 || jitterRatio <= 0) return delayMs;
	const span = delayMs * jitterRatio;
	const offset = (Math.random() * 2 - 1) * span;
	return Math.max(0, Math.round(delayMs + offset));
}
function canonicalJson(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const record = value;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
function inputRows(value) {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_INPUT_ROWS) throw new LoomApiError(400, `inputRows must contain 1-${MAX_INPUT_ROWS} object rows`);
	return value.map((row, index) => {
		const record = asRecord(row);
		if (Object.keys(record).length === 0) throw new LoomApiError(400, `inputRows[${index}] must be an object with at least one field`);
		return record;
	});
}
function validateRows(fields, rows) {
	const declared = new Set(fields.map((field) => field.key));
	for (const [rowIndex, row] of rows.entries()) {
		for (const key of Object.keys(row)) if (!declared.has(key)) throw new LoomApiError(400, `inputRows[${rowIndex}].${key} is not declared by the public input schema`);
		for (const field of fields) {
			const value = row[field.key];
			if (field.required && (value === void 0 || value === null || value === "")) throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} is required`);
			if (value === void 0 || value === null) continue;
			if (field.valueType === "boolean" || field.valueType === "bool") {
				if (typeof value !== "boolean") throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be a boolean`);
			} else if (field.valueType === "integer") {
				if (typeof value !== "number" || !Number.isInteger(value)) throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be an integer`);
			} else if (field.valueType === "number" || field.valueType === "float") {
				if (typeof value !== "number" || !Number.isFinite(value)) throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be a number`);
			} else if (field.valueType === "enum") {
				if (typeof value !== "string") throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be a string`);
			} else if (field.valueType === "string" && typeof value !== "string") throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be a string`);
		}
	}
}
function extractRun(value) {
	const outer = asRecord(value);
	const run = typeof outer.run === "string" ? { runId: outer.run } : asRecord(outer.run ?? outer.data ?? outer);
	const runId = text$1(run.runId) || text$1(outer.runId);
	const status = text$1(run.status) || text$1(outer.status);
	return {
		...ID_PATTERN.test(runId) ? { runId } : {},
		...status === "" ? {} : { status }
	};
}
function runRecord(value) {
	const payload = asRecord(value);
	return asRecord(payload.run ?? payload.data ?? payload);
}
function resultItems(value) {
	const payload = asRecord(value);
	const items = payload.items ?? payload.rows;
	return Array.isArray(items) ? items.map(asRecord) : [];
}
function artifacts(value) {
	const payload = asRecord(value);
	const items = payload.items ?? payload.artifacts;
	if (!Array.isArray(items)) return [];
	return items.map(asRecord).map((item, index) => {
		const id = text$1(item.artifactId);
		if (!ID_PATTERN.test(id)) throw new LoomApiError(502, `loomloom returned invalid artifact ${index + 1}`);
		const label = pickText(item, [
			"stepLabel",
			"displayName",
			"portName",
			"stepId"
		]) || id;
		const mimeType = text$1(item.mimeType);
		const accessUrl = text$1(item.accessUrl);
		if (accessUrl !== "" && !/^https:\/\//u.test(accessUrl)) throw new LoomApiError(502, `loomloom returned invalid artifact URL ${index + 1}`);
		const inlineText = capArtifactText(pickText(item, [
			"inlineText",
			"inline_text",
			"content",
			"text"
		]));
		return {
			id,
			label,
			...mimeType === "" ? {} : { mimeType },
			...accessUrl === "" ? {} : { accessUrl },
			...inlineText === "" ? {} : { inlineText }
		};
	});
}
/**
* Parse one creator-owned listing (`/creators/me/marketListings`). Unlike the
* public market listing this shape carries review fields, so the id and name
* keys stay the same while review state is surfaced when present.
*/
function creatorListing(value) {
	const id = text$1(value.id);
	if (!ID_PATTERN.test(id)) throw new LoomApiError(502, "loomloom returned a creator listing without a valid id");
	const currency = pickText(value, ["currency"]);
	const fee = money$1(value, "taskFixedFee", "taskFixedFeeT", currency);
	return {
		id,
		name: text$1(value.displayName) || id,
		description: text$1(value.description),
		available: text$1(value.executionAvailabilityStatus) === "available",
		...text$1(value.status) === "" ? {} : { status: text$1(value.status) },
		...text$1(value.saleStatus) === "" ? {} : { saleStatus: text$1(value.saleStatus) },
		...fee === void 0 ? {} : { fixedFee: fee.amount },
		...fee?.currency === void 0 && currency === "" ? {} : { currency: fee?.currency ?? currency },
		...text$1(value.listingVersionId) === "" ? {} : { listingVersionId: text$1(value.listingVersionId) },
		...text$1(value.publishedVersionId) === "" ? {} : { publishedVersionId: text$1(value.publishedVersionId) },
		...pickText(value, ["reviewStatus", "review_status"]) === "" ? {} : { reviewStatus: pickText(value, ["reviewStatus", "review_status"]) },
		...pickText(value, ["reviewReason", "review_reason"]) === "" ? {} : { reviewReason: pickText(value, ["reviewReason", "review_reason"]) }
	};
}
/** Parse one creator transaction (`/creators/me/marketTransactions`). */
function creatorTransaction(value) {
	const currency = pickText(value, ["currency"]);
	const fee = money$1(value, "taskFixedFee", "taskFixedFeeT", currency);
	const payable = money$1(value, "finalBuyerPayable", "finalBuyerPayableT", currency);
	return {
		...text$1(value.runTransactionId) === "" ? {} : { runTransactionId: text$1(value.runTransactionId) },
		...text$1(value.runId) === "" ? {} : { runId: text$1(value.runId) },
		...text$1(value.listingId) === "" ? {} : { listingId: text$1(value.listingId) },
		...pickText(value, ["skillName", "skill_name"]) === "" ? {} : { skillName: pickText(value, ["skillName", "skill_name"]) },
		...fee === void 0 ? {} : { taskFixedFee: fee.amount },
		...payable === void 0 ? {} : { finalBuyerPayable: payable.amount },
		...fee?.currency === void 0 && payable?.currency === void 0 && currency === "" ? {} : { currency: fee?.currency ?? payable?.currency ?? currency },
		...text$1(value.transactionStatus) === "" ? {} : { transactionStatus: text$1(value.transactionStatus) }
	};
}
/** Parse one official template summary (`GET /officialTemplates`). */
function officialTemplate(value) {
	const templateId = pickText(value, [
		"templateId",
		"template_id",
		"id"
	]);
	if (!ID_PATTERN.test(templateId)) throw new LoomApiError(502, "loomloom returned an official template without a valid id");
	return {
		templateId,
		name: pickText(value, ["name", "displayName"]) || templateId,
		...pickText(value, ["scenario"]) === "" ? {} : { scenario: pickText(value, ["scenario"]) },
		...pickText(value, ["inputSummary", "input_summary"]) === "" ? {} : { inputSummary: pickText(value, ["inputSummary", "input_summary"]) },
		...pickText(value, ["outputType", "output_type"]) === "" ? {} : { outputType: pickText(value, ["outputType", "output_type"]) },
		...pickText(value, ["version"]) === "" ? {} : { version: pickText(value, ["version"]) }
	};
}
/** Parse one private template summary (`GET /users/me/templates`). */
function myTemplate(value) {
	const templateId = pickText(value, [
		"templateId",
		"template_id",
		"id"
	]);
	if (!ID_PATTERN.test(templateId)) throw new LoomApiError(502, "loomloom returned a private template without a valid id");
	return {
		templateId,
		name: pickText(value, ["name", "displayName"]) || templateId,
		...pickText(value, ["description"]) === "" ? {} : { description: pickText(value, ["description"]) },
		...pickText(value, ["status"]) === "" ? {} : { status: pickText(value, ["status"]) },
		...pickText(value, ["latestVersionId", "latest_version_id"]) === "" ? {} : { latestVersionId: pickText(value, ["latestVersionId", "latest_version_id"]) },
		...pickText(value, ["publishedVersionId", "published_version_id"]) === "" ? {} : { publishedVersionId: pickText(value, ["publishedVersionId", "published_version_id"]) },
		...pickText(value, [
			"primaryOutputType",
			"primary_output_type",
			"outputType"
		]) === "" ? {} : { outputType: pickText(value, [
			"primaryOutputType",
			"primary_output_type",
			"outputType"
		]) }
	};
}
/** Parse the declared fields of an official template schema. */
function templateFields(value) {
	if (!Array.isArray(value)) return [];
	return value.map((field, index) => {
		const record = asRecord(field);
		const key = pickText(record, [
			"key",
			"fieldKey",
			"name"
		]);
		if (!ID_PATTERN.test(key)) throw new LoomApiError(502, `loomloom template field ${index + 1} is invalid`);
		const enums = record.enumValues ?? record.enum_values;
		const examples = record.examples;
		const enumValues = Array.isArray(enums) ? enums.filter((item) => typeof item === "string") : void 0;
		const exampleValues = Array.isArray(examples) ? examples.filter((item) => typeof item === "string") : void 0;
		const hint = pickText(record, [
			"inputHint",
			"input_hint",
			"businessHint",
			"business_hint"
		]);
		return {
			key,
			label: pickText(record, ["label", "title"]) || key,
			required: record.required === true,
			valueType: pickText(record, [
				"type",
				"valueType",
				"value_type"
			]) || "string",
			...hint === "" ? {} : { inputHint: hint },
			...enumValues === void 0 || enumValues.length === 0 ? {} : { enumValues },
			...exampleValues === void 0 || exampleValues.length === 0 ? {} : { examples: exampleValues }
		};
	});
}
/** Parse the full schema of one official template. */
function templateSchema(value) {
	const templateId = pickText(value, [
		"templateId",
		"template_id",
		"id"
	]);
	if (!ID_PATTERN.test(templateId)) throw new LoomApiError(502, "loomloom returned a template schema without a valid id");
	return {
		templateId,
		fields: templateFields(value.fields),
		...pickText(value, ["name", "displayName"]) === "" ? {} : { name: pickText(value, ["name", "displayName"]) },
		...pickText(value, ["description"]) === "" ? {} : { description: pickText(value, ["description"]) },
		...pickText(value, ["scenario"]) === "" ? {} : { scenario: pickText(value, ["scenario"]) },
		...pickText(value, ["outputType", "output_type"]) === "" ? {} : { outputType: pickText(value, ["outputType", "output_type"]) }
	};
}
function monetaryText(value) {
	if (typeof value === "number" && Number.isFinite(value)) return { amount: String(value) };
	if (typeof value === "string" && value.trim() !== "") return { amount: value.trim() };
	const record = asRecord(value);
	const amount = pickText(record, [
		"amount",
		"displayAmount",
		"formatted",
		"value"
	]);
	if (amount === "") return void 0;
	const currency = pickText(record, ["currency", "currencyCode"]);
	return {
		amount,
		...currency === "" ? {} : { currency }
	};
}
/**
* Resolve a monetary field the same way the upstream CLI does: prefer the
* converted `moneyResponse` object; otherwise convert the raw-unit `*T`
* integer using `10,000,000 units = 1 currency unit`. Currency is never
* guessed when only a `*T` value is present.
*/
function money$1(value, moneyKey, rawKey, currency) {
	const converted = monetaryText(value[moneyKey]);
	if (converted !== void 0) return {
		...converted,
		...converted.currency === void 0 && currency !== "" ? { currency } : {}
	};
	const raw = value[rawKey];
	const units = typeof raw === "number" && Number.isSafeInteger(raw) ? BigInt(raw) : typeof raw === "string" && /^-?\d+$/u.test(raw.trim()) ? BigInt(raw.trim()) : void 0;
	if (units === void 0) return void 0;
	const negative = units < 0n;
	const absolute = negative ? -units : units;
	const whole = absolute / RAW_UNITS_PER_CURRENCY_BIGINT;
	const fraction = (absolute % RAW_UNITS_PER_CURRENCY_BIGINT).toString().padStart(7, "0").replace(/0+$/u, "");
	return {
		amount: `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`,
		...currency === "" ? {} : { currency }
	};
}
function parseQuote(value) {
	const payload = asRecord(value);
	const quote = asRecord(payload.quote ?? payload.data ?? payload);
	const currency = pickText(quote, ["currency", "currencyCode"]) || pickText(payload, ["currency", "currencyCode"]);
	const payable = money$1(quote, "estimatedBuyerPayable", "estimatedBuyerPayableT", currency) ?? money$1(payload, "estimatedBuyerPayable", "estimatedBuyerPayableT", currency);
	if (payable === void 0) throw new LoomApiError(502, "loomloom quote did not return an estimated buyer payable amount");
	const fee = money$1(quote, "taskFixedFee", "taskFixedFeeT", currency) ?? money$1(payload, "taskFixedFee", "taskFixedFeeT", currency);
	return {
		estimatedBuyerPayable: payable.amount,
		...payable.currency === void 0 ? {} : { currency: payable.currency },
		...fee === void 0 ? {} : { taskFixedFee: fee.amount }
	};
}
var LoomSkillbotService = class {
	api;
	now;
	drafts = /* @__PURE__ */ new Map();
	constructor(api, now = Date.now) {
		this.api = api;
		this.now = now;
	}
	async list(signal, options = {}) {
		const merged = [];
		const seen = /* @__PURE__ */ new Set();
		let pageToken = "";
		let complete = false;
		const keyword = text$1(options.keyword);
		for (let page = 0; page < MAX_MARKET_PAGES; page += 1) {
			const query = new URLSearchParams({ pageSize: "100" });
			if (pageToken !== "") query.set("pageToken", pageToken);
			const payload = asRecord(await this.api.request(`/marketListings?${query.toString()}`, {}, signal));
			const items = Array.isArray(payload.items) ? payload.items : [];
			for (const item of items) {
				const candidate = summary(asRecord(item));
				if (candidate.available) {
					if (merged.length >= MAX_MARKET_LISTINGS) throw new LoomApiError(502, "loomloom market listing limit exceeded");
					merged.push(candidate);
				}
			}
			pageToken = nextPageToken(payload);
			if (keyword === "") {
				complete = true;
				break;
			}
			if (pageToken === "") {
				complete = true;
				break;
			}
			if (seen.has(pageToken)) throw new LoomApiError(502, "loomloom returned a repeating market listing page token");
			seen.add(pageToken);
		}
		if (!complete) throw new LoomApiError(502, "loomloom market page limit exceeded");
		return keyword === "" ? merged : matchKeyword(merged, keyword);
	}
	async get(listingId, signal) {
		if (!ID_PATTERN.test(listingId)) throw new LoomApiError(400, "invalid listingId");
		const payload = asRecord(await this.api.request(`/marketListings/${encodeURIComponent(listingId)}`, {}, signal));
		return {
			...summary(payload),
			fields: parseFields(payload)
		};
	}
	/**
	* Read the settled balance snapshot. `/users/me/balance` carries the raw
	* `availableBalanceT` integer and the converted `availableBalance` object;
	* `money()` prefers the converted form and never guesses the currency.
	*/
	async getBalance(signal) {
		const payload = asRecord(await this.api.request("/users/me/balance", {}, signal));
		const currency = pickText(payload, ["currency"]);
		const available = money$1(payload, "availableBalance", "availableBalanceT", currency);
		return {
			...available?.currency === void 0 && currency === "" ? {} : { currency: available?.currency ?? currency },
			...available === void 0 ? {} : { availableBalance: available.amount }
		};
	}
	/** List creator-owned Market listings from `/creators/me/marketListings`. */
	async listMyListings(signal) {
		const payload = asRecord(await this.api.request("/creators/me/marketListings?pageSize=100", {}, signal));
		return (Array.isArray(payload.items) ? payload.items : []).map((item) => creatorListing(asRecord(item)));
	}
	/** List creator Market transactions from `/creators/me/marketTransactions`. */
	async listCreatorTransactions(signal) {
		const payload = asRecord(await this.api.request("/creators/me/marketTransactions?pageSize=100", {}, signal));
		return (Array.isArray(payload.items) ? payload.items : []).map((item) => creatorTransaction(asRecord(item)));
	}
	/** List official (first-party) templates from `GET /officialTemplates`. */
	async listOfficialTemplates(signal) {
		const payload = asRecord(await this.api.request("/officialTemplates", {}, signal));
		return (Array.isArray(payload.templates) ? payload.templates : Array.isArray(payload.items) ? payload.items : []).map((item) => officialTemplate(asRecord(item)));
	}
	/**
	* List the account's private (creator-authored) templates. Publishing a
	* listing requires a template id and version id, and both come from here.
	*/
	async listMyTemplates(signal) {
		const payload = asRecord(await this.api.request("/users/me/templates?pageSize=50", {}, signal));
		return (Array.isArray(payload.items) ? payload.items : Array.isArray(payload.templates) ? payload.templates : []).map((item) => myTemplate(asRecord(item)));
	}
	/** Read one official template input schema from `GET /officialTemplates/{id}/schema`. */
	async getTemplateSchema(templateId, signal) {
		if (!ID_PATTERN.test(templateId)) throw new LoomApiError(400, "invalid templateId");
		return templateSchema(asRecord(await this.api.request(`/officialTemplates/${encodeURIComponent(templateId)}/schema`, {}, signal)));
	}
	/** Download a Market SkillBot input workbook (`GET /marketListings/{id}/workbook`). */
	async downloadMarketWorkbook(listingId, signal) {
		if (!ID_PATTERN.test(listingId)) throw new LoomApiError(400, "invalid listingId");
		const binary = await this.api.requestBinary(`/marketListings/${encodeURIComponent(listingId)}/workbook`, {}, signal);
		return {
			base64: binary.base64,
			byteLength: binary.byteLength,
			contentType: binary.contentType,
			filename: binary.filename ?? `${listingId}.xlsx`
		};
	}
	/** Download an official template input workbook (`GET /officialTemplates/{id}/workbook`). */
	async downloadTemplateWorkbook(templateId, signal) {
		if (!ID_PATTERN.test(templateId)) throw new LoomApiError(400, "invalid templateId");
		const binary = await this.api.requestBinary(`/officialTemplates/${encodeURIComponent(templateId)}/workbook`, {}, signal);
		return {
			base64: binary.base64,
			byteLength: binary.byteLength,
			contentType: binary.contentType,
			filename: binary.filename ?? `${templateId}.xlsx`
		};
	}
	async getSkillPackage(listingId, signal) {
		if (!ID_PATTERN.test(listingId)) throw new LoomApiError(400, "invalid listingId");
		const payload = asRecord(await this.api.request(`/marketListings/${encodeURIComponent(listingId)}/skillPackage`, {}, signal));
		const archiveHash = pickText(payload, ["archiveHash", "archive_hash"]);
		const versionId = pickText(payload, ["skillPackageVersionId", "skill_package_version_id"]);
		const mode = pickText(payload, ["mode"]);
		const reason = pickText(payload, ["unavailableReason", "unavailable_reason"]);
		const size = payload.sizeBytes ?? payload.size_bytes;
		return {
			available: payload.available === true,
			archiveHash,
			...versionId === "" ? {} : { versionId },
			...mode === "" ? {} : { mode },
			...typeof size === "number" && Number.isFinite(size) ? { sizeBytes: size } : {},
			...reason === "" ? {} : { unavailableReason: reason }
		};
	}
	async downloadSkillPackage(listingId, signal) {
		const summary = await this.getSkillPackage(listingId, signal);
		if (!summary.available) throw new LoomApiError(409, `skill package is unavailable${summary.unavailableReason === void 0 ? "" : `: ${summary.unavailableReason}`}`);
		const binary = await this.api.requestBinary(`/marketListings/${encodeURIComponent(listingId)}/skillPackage/archive`, {}, signal);
		const archive = Buffer.from(binary.base64, "base64");
		if (summary.archiveHash !== "") {
			const actualHash = createHash("sha256").update(archive).digest("hex");
			if (normalizeArchiveHash(summary.archiveHash) !== actualHash) throw new LoomApiError(502, "skill package archive does not match the published hash");
		}
		return {
			archive,
			summary
		};
	}
	async installSkill(listingId, skillRoot, signal) {
		if (!ID_PATTERN.test(listingId)) throw new LoomApiError(400, "invalid listingId");
		const summary = await this.getSkillPackage(listingId, signal);
		if (!summary.available) throw new LoomApiError(409, `skill package is unavailable${summary.unavailableReason === void 0 ? "" : `: ${summary.unavailableReason}`}`);
		const sourceRef = `market:${listingId}`;
		const installed = await findInstalledSkillPackage(skillRoot, sourceRef, summary.archiveHash);
		if (installed !== void 0) return installed;
		const binary = await this.api.requestBinary(`/marketListings/${encodeURIComponent(listingId)}/skillPackage/archive`, {}, signal);
		const archive = Buffer.from(binary.base64, "base64");
		return await installSkillPackage({
			skillRoot,
			sourceRef,
			archiveHash: summary.archiveHash,
			archive
		});
	}
	/**
	* Upload JSONL orchestration input rows (`POST /orchestrationInputs:upload`).
	* The upstream expects `content` as raw bytes, which Go encodes as base64 in
	* JSON, so the caller's text is base64 encoded here.
	*/
	async uploadOrchestrationInput(filename, content, signal) {
		const name = text$1(filename);
		if (name === "") throw new LoomApiError(400, "filename is required");
		if (text$1(content) === "") throw new LoomApiError(400, "content is required");
		const payload = {
			filename: name,
			content: Buffer.from(content, "utf8").toString("base64")
		};
		const response = asRecord(await this.api.request("/orchestrationInputs:upload", {
			method: "POST",
			body: JSON.stringify(payload)
		}, signal));
		const inputFileId = pickText(response, ["inputFileId", "input_file_id"]);
		if (inputFileId === "") throw new LoomApiError(502, "loomloom did not return an inputFileId");
		const rowCount = response.rowCount ?? response.row_count;
		return {
			inputFileId,
			...typeof rowCount === "number" && Number.isFinite(rowCount) ? { rowCount } : {}
		};
	}
	async publishListing(input, signal) {
		const displayName = text$1(input.displayName);
		if (displayName === "") throw new LoomApiError(400, "displayName is required");
		const templateId = text$1(input.templateId);
		if (!ID_PATTERN.test(templateId)) throw new LoomApiError(400, "templateId is required");
		const templateVersionId = text$1(input.templateVersionId);
		if (!ID_PATTERN.test(templateVersionId)) throw new LoomApiError(400, "templateVersionId is required");
		const listingId = text$1(input.listingId);
		if (listingId !== "" && !ID_PATTERN.test(listingId)) throw new LoomApiError(400, "listingId is invalid");
		if (!Number.isFinite(input.taskFixedFee) || input.taskFixedFee < 0 || input.taskFixedFee > Number.MAX_SAFE_INTEGER / RAW_UNITS_PER_CURRENCY) throw new LoomApiError(400, "taskFixedFee must be a non-negative number that can be represented exactly");
		const scaledFee = input.taskFixedFee * RAW_UNITS_PER_CURRENCY;
		if (!Number.isInteger(scaledFee)) throw new LoomApiError(400, "taskFixedFee supports at most 7 decimal places");
		const taskFixedFeeT = scaledFee;
		if (!Number.isSafeInteger(taskFixedFeeT)) throw new LoomApiError(400, "taskFixedFee must be representable in raw API units");
		const payload = {
			displayName,
			templateId,
			templateVersionId,
			taskFixedFeeT,
			...text$1(input.description) === "" ? {} : { description: text$1(input.description) },
			...listingId === "" ? {} : { listingId }
		};
		const response = asRecord(await this.api.request("/marketListings", {
			method: "POST",
			body: JSON.stringify(payload)
		}, signal));
		const id = text$1(response.id) || text$1(response.listingId);
		if (!ID_PATTERN.test(id)) throw new LoomApiError(502, "loomloom did not return a published listing id");
		const status = text$1(response.status);
		const reviewStatus = pickText(response, ["reviewStatus", "review_status"]);
		const reviewRequestId = pickText(response, ["reviewRequestId", "review_request_id"]);
		const name = text$1(response.displayName);
		return {
			id,
			...status === "" ? {} : { status },
			...reviewStatus === "" ? {} : { reviewStatus },
			...reviewRequestId === "" ? {} : { reviewRequestId },
			...name === "" ? {} : { name }
		};
	}
	async getRun(runId, signal) {
		if (!ID_PATTERN.test(runId)) throw new LoomApiError(400, "invalid runId");
		const payload = runRecord(await this.api.request(`/users/me/runs/${encodeURIComponent(runId)}`, {}, signal));
		return {
			runId: text$1(payload.runId) || runId,
			status: text$1(payload.status) || "unknown",
			displayName: pickText(payload, ["displayName", "name"]) || runId
		};
	}
	async getRunResults(runId, signal) {
		if (!ID_PATTERN.test(runId)) throw new LoomApiError(400, "invalid runId");
		const detail = await this.getRun(runId, signal);
		const [rowsPayload, artifactsPayload] = await Promise.all([this.api.request(`/users/me/runs/${encodeURIComponent(runId)}/resultRows?pageSize=100`, {}, signal), this.api.request(`/users/me/runs/${encodeURIComponent(runId)}/artifacts?pageSize=100`, {}, signal)]);
		const rows = resultItems(rowsPayload);
		const completedRows = rows.filter((row) => [
			"completed",
			"succeeded",
			"success"
		].includes(pickText(row, ["status"]).toLowerCase())).length;
		const failedRows = rows.filter((row) => [
			"failed",
			"cancelled",
			"canceled"
		].includes(pickText(row, ["status"]).toLowerCase())).length;
		return {
			runId: detail.runId,
			status: detail.status,
			totalRows: rows.length,
			completedRows,
			failedRows,
			artifacts: artifacts(artifactsPayload)
		};
	}
	/**
	* Poll a run until it reaches a terminal status, the host signal aborts, or
	* the total wait budget elapses. The returned summary is the canonical input
	* for an execute_skillbot tool result: pending distinguishes a
	* dispatch-cancelled or budget-exhausted exit from a clean terminal state.
	*/
	async pollRunUntilTerminal(runId, options = {}, signal) {
		if (!ID_PATTERN.test(runId)) throw new LoomApiError(400, "invalid runId");
		if (signal?.aborted) throw new LoomApiError(499, "run polling was cancelled before it started");
		const initialDelayMs = options.initialDelayMs ?? DEFAULT_POLL_INITIAL_MS;
		const maxDelayMs = options.maxDelayMs ?? DEFAULT_POLL_MAX_MS;
		const jitterRatio = options.jitterRatio ?? DEFAULT_POLL_JITTER;
		const maxWaitMs = options.maxWaitMs ?? DEFAULT_POLL_MAX_WAIT_MS;
		const sleep = options.sleep ?? setTimeout$1;
		const now = options.now ?? Date.now;
		const startedAt = now();
		let attempts = 0;
		let nextDelay = initialDelayMs;
		let last;
		while (true) {
			if (signal?.aborted) {
				const summary = last ?? {
					runId,
					status: "unknown",
					displayName: runId
				};
				return {
					...summary,
					terminal: TERMINAL_RUN_STATUSES.has(summary.status.toLowerCase()),
					pending: true,
					attempts
				};
			}
			if (now() - startedAt >= maxWaitMs) {
				const summary = last ?? {
					runId,
					status: "unknown",
					displayName: runId
				};
				return {
					...summary,
					terminal: TERMINAL_RUN_STATUSES.has(summary.status.toLowerCase()),
					pending: true,
					attempts
				};
			}
			attempts += 1;
			const detail = await this.getRun(runId, signal);
			last = detail;
			if (TERMINAL_RUN_STATUSES.has(detail.status.toLowerCase())) return {
				runId: detail.runId,
				status: detail.status,
				displayName: detail.displayName,
				terminal: true,
				pending: false,
				attempts
			};
			const remaining = Math.max(0, maxWaitMs - (now() - startedAt));
			const capped = Math.min(nextDelay, remaining);
			if (capped === 0) return {
				runId: detail.runId,
				status: detail.status,
				displayName: detail.displayName,
				terminal: false,
				pending: true,
				attempts
			};
			await sleep(applyJitter(capped, jitterRatio), signal);
			nextDelay = Math.min(maxDelayMs, nextDelay * 2);
		}
	}
	async prepare(agent, listingId, rows, signal) {
		const detail = await this.get(listingId, signal);
		if (!detail.available) throw new LoomApiError(409, "the selected SkillBot is not available");
		const normalizedRows = inputRows(rows);
		validateRows(detail.fields, normalizedRows);
		const quote = parseQuote(await this.api.request(`/marketListings/${encodeURIComponent(listingId)}:quote`, {
			method: "POST",
			body: JSON.stringify({ inputRows: normalizedRows })
		}, signal));
		const fingerprint = createHash("sha256").update(canonicalJson({
			listingId,
			normalizedRows
		})).digest("hex");
		this.prune();
		const draft = {
			id: `loom-draft-${randomUUID()}`,
			expiresAt: new Date(this.now() + DRAFT_TTL_MS).toISOString(),
			skillbot: detail,
			rowCount: normalizedRows.length,
			agent,
			inputRows: normalizedRows,
			fingerprint,
			clientRequestId: `loomloom-dsh-${randomUUID()}`,
			quote
		};
		this.drafts.set(draft.id, draft);
		return this.publicDraft(draft);
	}
	async execute(agent, draftId, signal) {
		this.prune();
		const draft = this.drafts.get(draftId);
		if (draft === void 0 || draft.agent !== agent) throw new LoomApiError(404, "execution draft is unavailable");
		const currentFingerprint = createHash("sha256").update(canonicalJson({
			listingId: draft.skillbot.id,
			normalizedRows: draft.inputRows
		})).digest("hex");
		if (draft.fingerprint !== currentFingerprint) throw new LoomApiError(409, "execution draft integrity check failed");
		const payload = {
			inputRows: draft.inputRows,
			clientRequestId: draft.clientRequestId,
			confirm: true
		};
		const response = await this.api.request(`/marketListings/${encodeURIComponent(draft.skillbot.id)}:execute`, {
			method: "POST",
			body: JSON.stringify(payload)
		}, signal);
		this.drafts.delete(draftId);
		return {
			draftId,
			accepted: true,
			...extractRun(response)
		};
	}
	describeDraft(draftId, agent) {
		this.prune();
		const draft = this.drafts.get(draftId);
		return draft === void 0 || draft.agent !== agent ? void 0 : this.publicDraft(draft);
	}
	publicDraft(draft) {
		return {
			id: draft.id,
			expiresAt: draft.expiresAt,
			skillbot: draft.skillbot,
			rowCount: draft.rowCount,
			quote: draft.quote
		};
	}
	prune() {
		const now = this.now();
		for (const [id, draft] of this.drafts) if (Date.parse(draft.expiresAt) <= now) this.drafts.delete(id);
	}
};
/** Plugin-owned settings namespace holding the last good storefront. */
const STOREFRONT_NAMESPACE = settingsNamespace("loomloom");
const EMPTY_SNAPSHOT = {
	version: 2,
	cacheKey: "",
	configured: false,
	savedAt: "",
	entries: [],
	unavailable: []
};
const StoredEntrySchema = z.object({
	id: z.string().default(""),
	name: z.string().default(""),
	description: z.string().default(""),
	available: z.boolean().default(false),
	inputSchemaSnapshot: z.string().default("{}"),
	version: z.string().default(""),
	updatedAt: z.string().default(""),
	creatorNickname: z.string().default(""),
	fixedFee: z.string().default(""),
	currency: z.string().default("")
});
const StorefrontCacheSchema = z.object({ storefront: z.object({
	version: z.number().default(1),
	cacheKey: z.string().default(""),
	configured: z.boolean().default(false),
	savedAt: z.string().default(""),
	entries: z.array(StoredEntrySchema).default([]),
	unavailable: z.array(z.string()).default([])
}).default(EMPTY_SNAPSHOT) });
function store(entry) {
	return {
		id: entry.id,
		name: entry.name,
		description: entry.description,
		available: entry.available,
		inputSchemaSnapshot: entry.inputSchemaSnapshot,
		version: entry.version ?? "",
		updatedAt: entry.updatedAt ?? "",
		creatorNickname: entry.creatorNickname ?? "",
		fixedFee: entry.fixedFee ?? "",
		currency: entry.currency ?? ""
	};
}
function restore(entry) {
	return {
		id: entry.id,
		name: entry.name,
		description: entry.description,
		available: entry.available,
		inputSchemaSnapshot: entry.inputSchemaSnapshot,
		...entry.version === "" ? {} : { version: entry.version },
		...entry.updatedAt === "" ? {} : { updatedAt: entry.updatedAt },
		...entry.creatorNickname === "" ? {} : { creatorNickname: entry.creatorNickname },
		...entry.fixedFee === "" ? {} : { fixedFee: entry.fixedFee },
		...entry.currency === "" ? {} : { currency: entry.currency }
	};
}
function age(fetchedAt) {
	const saved = Date.parse(fetchedAt);
	return Number.isFinite(saved) ? Date.now() - saved : Number.POSITIVE_INFINITY;
}
/**
* Wraps a storefront read in a last-good cache.
*
* Persistence goes through the standard settings service, matching how the
* community market stores its catalog snapshot, so the storefront survives a
* restart instead of paying for a cold read on every launch. The settings service
* is optional: a composition without it keeps the cache in memory and still
* works, rather than failing to load the plugin.
*
* A failed refresh never destroys what is already known. That matters more here
* than freshness — a transient Market outage must not blank a storefront the user
* was already browsing.
*/
function createStorefrontCache(ctx, read, options) {
	const scope = ctx.settings?.register(STOREFRONT_NAMESPACE, StorefrontCacheSchema);
	let memory;
	const persisted = () => {
		if (scope === void 0) return void 0;
		const stored = scope.get().storefront;
		if (stored.version !== 2 || stored.cacheKey !== options.cacheKey || stored.configured !== options.configured || stored.savedAt === "") return void 0;
		return {
			configured: stored.configured,
			entries: stored.entries.map(restore),
			unavailable: [...stored.unavailable],
			fetchedAt: stored.savedAt
		};
	};
	const current = () => memory ?? persisted();
	const commit = async (value, fetchedAt) => {
		const snapshot = {
			configured: value.configured,
			entries: value.entries,
			unavailable: value.unavailable,
			fetchedAt
		};
		memory = snapshot;
		if (scope !== void 0) await scope.update({ storefront: {
			version: 2,
			cacheKey: options.cacheKey,
			configured: value.configured,
			savedAt: fetchedAt,
			entries: value.entries.map(store),
			unavailable: [...value.unavailable]
		} });
		return snapshot;
	};
	return { async read(force = false) {
		const previous = current();
		if (!force && previous !== void 0 && age(previous.fetchedAt) < 6e5) return {
			...previous,
			stale: false
		};
		try {
			const fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
			return {
				...await commit(await read(), fetchedAt),
				stale: false
			};
		} catch (cause) {
			const message = cause instanceof Error && cause.message.trim() !== "" ? cause.message : "storefront refresh failed";
			if (previous !== void 0) return {
				...previous,
				stale: true,
				error: message
			};
			return {
				configured: options.configured,
				entries: [],
				unavailable: [],
				fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
				stale: true,
				error: message
			};
		}
	} };
}
/** Per-listing ceiling. One slow listing must not hold the whole storefront. */
const STOREFRONT_REQUEST_TIMEOUT_MS = 1e4;
/** Reads one named secret from an environment; unset or blank reads as absent. */
function envSecret(env, name) {
	if (name === void 0) return void 0;
	const value = env[name]?.trim();
	return value === void 0 || value === "" ? void 0 : value;
}
/** Resolves the live source from configuration plus the creator credential, if any. */
function storefrontSourceFor(config, creatorKey) {
	if (config.creatorKeyEnv !== void 0) return creatorKey === void 0 ? "public" : "creator";
	return config.storefrontListingIds.length > 0 ? "pinned" : "public";
}
/** Persist only a digest, never the creator credential itself. */
function storefrontCacheKey(config, creatorKey) {
	const source = storefrontSourceFor(config, creatorKey);
	return createHash("sha256").update(JSON.stringify([
		config.baseUrl,
		source,
		source === "creator" ? creatorKey : source === "pinned" ? config.storefrontListingIds : null
	])).digest("hex");
}
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function text(value) {
	return typeof value === "string" ? value.trim() : "";
}
/** Reads `{ amount, currency }`, tolerating a bare string. */
function money(value) {
	if (typeof value === "string") return {
		amount: value.trim(),
		currency: ""
	};
	const item = record(value);
	return {
		amount: text(item.amount ?? item.value),
		currency: text(item.currency ?? item.currencyCode)
	};
}
function entry(value, fallbackId) {
	const item = record(value);
	const creator = record(item.creator);
	const fee = money(item.taskFixedFee);
	const version = text(item.version);
	const updatedAt = text(item.updatedAt ?? item.updated_at);
	const creatorNickname = text(creator.nickname);
	const currency = fee.currency === "" ? text(item.currency) : fee.currency;
	return {
		id: text(item.id ?? item.listingId) || fallbackId,
		name: text(item.displayName ?? item.name) || fallbackId,
		description: text(item.description),
		available: text(item.executionAvailabilityStatus).toLowerCase() === "available",
		inputSchemaSnapshot: typeof item.inputSchemaSnapshot === "string" ? item.inputSchemaSnapshot : JSON.stringify(record(item.inputSchemaSnapshot)),
		...version === "" ? {} : { version },
		...updatedAt === "" ? {} : { updatedAt },
		...creatorNickname === "" ? {} : { creatorNickname },
		...fee.amount === "" ? {} : { fixedFee: fee.amount },
		...currency === "" ? {} : { currency }
	};
}
/**
* Runs `work` over `items` with a fixed number of workers, preserving order.
*
* Every item settles before the caller resumes, so a failure never leaves a
* request in flight behind a rejected promise.
*/
async function mapSettled(items, limit, work) {
	const results = new Array(items.length);
	let cursor = 0;
	const worker = async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			const item = items[index];
			if (item === void 0) continue;
			try {
				results[index] = {
					ok: true,
					value: await work(item)
				};
			} catch (cause) {
				results[index] = {
					ok: false,
					cause
				};
			}
		}
	};
	const workerCount = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: workerCount }, worker));
	return results;
}
/** Bound on creator pagination; a storefront is far smaller than this. */
const CREATOR_DISCOVERY_PAGE_SIZE = 200;
const CREATOR_DISCOVERY_MAX_PAGES = 10;
const PUBLIC_MARKET_PAGE_SIZE = 100;
const PUBLIC_MARKET_MAX_PAGES = 20;
/** Read the complete bounded public catalogue for the default storefront. */
async function readPublicMarket(api, signal) {
	const entries = [];
	const seen = /* @__PURE__ */ new Set();
	const seenPageTokens = /* @__PURE__ */ new Set();
	let pageToken = "";
	for (let page = 0; page < PUBLIC_MARKET_MAX_PAGES; page += 1) {
		const query = new URLSearchParams({ pageSize: String(PUBLIC_MARKET_PAGE_SIZE) });
		if (pageToken !== "") query.set("pageToken", pageToken);
		const payload = record(await api.request(`/marketListings?${query.toString()}`, {}, signal));
		const items = Array.isArray(payload.items) ? payload.items : [];
		for (const value of items) {
			const item = record(value);
			const id = text(item.id ?? item.listingId);
			if (id === "" || !MARKET_LISTING_ID_PATTERN.test(id) || seen.has(id)) continue;
			seen.add(id);
			const normalized = entry(item, id);
			if (normalized.available) entries.push(normalized);
		}
		const next = text(payload.nextPageToken ?? payload.next_page_token);
		if (next === "" || items.length === 0) return {
			configured: true,
			entries,
			unavailable: []
		};
		if (seenPageTokens.has(next)) throw new Error("loomloom returned a repeating public market page token");
		seenPageTokens.add(next);
		pageToken = next;
	}
	throw new Error("loomloom public market page limit exceeded");
}
/** Newest first, undated entries last, ties broken by name for a stable order. */
function byRecency(left, right) {
	const leftAt = left.updatedAt === void 0 ? Number.NEGATIVE_INFINITY : Date.parse(left.updatedAt);
	const rightAt = right.updatedAt === void 0 ? Number.NEGATIVE_INFINITY : Date.parse(right.updatedAt);
	if (leftAt !== rightAt) return rightAt - leftAt;
	return left.name.localeCompare(right.name);
}
/**
* Derives the storefront id set from the creator's own catalogue.
*
* `GET /creators/me/marketListings` is the only route that publishes a stable
* creator↔listing relationship *and* the sale status, so it is what makes the
* storefront track new publications instead of a hand-maintained id list. It is
* read with the creator credential purely for discovery: every detail below is
* still fetched anonymously, so the storefront content stays public data.
*
* `status: published` alone is not enough — the public market only carries
* `saleStatus: listed`, and the public detail route answers `404` for anything
* unlisted. Taking unlisted ids would put entries in the storefront that can never
* resolve.
*/
async function discoverCreatorListingIds(creatorApi, signal) {
	const ids = [];
	const seen = /* @__PURE__ */ new Set();
	let pageToken;
	for (let page = 0; page < CREATOR_DISCOVERY_MAX_PAGES; page += 1) {
		const query = new URLSearchParams({ pageSize: String(CREATOR_DISCOVERY_PAGE_SIZE) });
		if (pageToken !== void 0) query.set("pageToken", pageToken);
		const payload = record(await creatorApi.request(`/creators/me/marketListings?${query.toString()}`, {}, signal));
		const items = Array.isArray(payload.items) ? payload.items : [];
		for (const value of items) {
			const item = record(value);
			if (text(item.status) !== "published" || text(item.saleStatus) !== "listed") continue;
			const id = text(item.id ?? item.listingId);
			if (id === "" || !MARKET_LISTING_ID_PATTERN.test(id) || seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
		}
		const next = text(payload.nextPageToken);
		if (next === "" || items.length === 0) break;
		pageToken = next;
	}
	return ids;
}
/**
* Reads the configured storefront from anonymous public Market reads.
*
* Two sources, in order of authority:
*
* - **Creator mode** (`creatorKeyEnv` configured): the id set is derived from the
*   creator's own catalogue on every refresh, so a newly published SkillBot shows
*   up with no maintenance. A missing credential resolves to an empty read rather
*   than falling back to a pinned list — a silent fallback would hide the
*   misconfiguration and quietly stop tracking new publications.
* - **Pinned mode**: the allow-list from config. One id maps to one detail call
*   rather than a walk over the full public market, because the full market's list
*   route returns no creator identifier at all (every `creator` is
*   `{ nickname: "" }`) so it cannot be filtered by creator, and the detail payload
*   is the only source of the version and update time the preview must show.
*
* A `404` means that listing is no longer listed: it is reported as unavailable
* instead of failing the storefront. Any other failure is transient and is
* re-thrown so the cache layer can fall back to its last good snapshot.
*/
function createStorefrontReader(api, config, options = {}) {
	return async (signal) => {
		if (options.publicMarket === true) return readPublicMarket(api, signal);
		if (options.creator === null) return {
			configured: false,
			entries: [],
			unavailable: []
		};
		const ids = options.creator === void 0 ? config.storefrontListingIds : await discoverCreatorListingIds(options.creator, signal);
		const derived = options.creator !== void 0;
		if (ids.length === 0) return {
			configured: derived || config.storefrontListingIds.length > 0,
			entries: [],
			unavailable: []
		};
		const settled = await mapSettled(ids, 6, async (id) => {
			const requestSignal = AbortSignal.any([AbortSignal.timeout(STOREFRONT_REQUEST_TIMEOUT_MS), ...signal === void 0 ? [] : [signal]]);
			try {
				return {
					listed: true,
					payload: await api.request(`/marketListings/${encodeURIComponent(id)}`, {}, requestSignal)
				};
			} catch (cause) {
				if (cause.status === 404) return {
					listed: false,
					payload: void 0
				};
				throw cause;
			}
		});
		const entries = [];
		const unavailable = [];
		const failures = [];
		settled.forEach((result, index) => {
			const id = ids[index] ?? "";
			if (result.ok) if (result.value.listed) entries.push(entry(result.value.payload, id));
			else unavailable.push(id);
			else if (failures.length === 0) failures.push(result.cause);
		});
		if (failures.length > 0) throw failures[0];
		return {
			configured: true,
			entries: derived ? entries.sort(byRecency) : entries,
			unavailable
		};
	};
}
/** Whole-meta budget, applied to the serialized value the session log stores. */
const MAX_META_CHARS = MAX_ARTIFACT_TEXT_CHARS;
/** Copies a described payload into plain JSON: the log stores arrays, not readonly views. */
function jsonView(view) {
	switch (view.kind) {
		case "table": return {
			kind: "table",
			columns: [...view.columns],
			rows: view.rows.map((row) => [...row]),
			totalRows: view.totalRows,
			omittedColumns: view.omittedColumns
		};
		case "fields": return {
			kind: "fields",
			rows: view.rows.map((row) => [row[0], row[1]])
		};
		case "scalars": return {
			kind: "scalars",
			rows: [...view.rows]
		};
		case "text": return {
			kind: "text",
			text: view.text
		};
		case "empty": return {
			kind: "empty",
			reason: view.reason
		};
	}
}
/** One artifact's payload as a view, or absent when there is nothing to draw. */
function artifactView(inlineText) {
	if (inlineText === void 0 || inlineText.trim() === "") return { truncated: false };
	const parsed = parseInlineJson(inlineText);
	if (parsed !== void 0) return {
		view: jsonView(describePayload(parsed)),
		truncated: false
	};
	const capped = capArtifactText(inlineText);
	return {
		view: jsonView({
			kind: "text",
			text: capped
		}),
		truncated: capped !== inlineText
	};
}
/** Applies a row cap to every table/scalar view, marking what it cut. */
function capRows(artifacts, rows) {
	let cut = false;
	for (const artifact of artifacts) {
		const view = artifact.view;
		if (typeof view !== "object" || view === null || Array.isArray(view)) continue;
		const kind = view.kind;
		if (kind !== "table" && kind !== "scalars") continue;
		const current = view.rows;
		if (current.length === 0) continue;
		const keep = rows === 0 ? [] : current.slice(0, rows);
		if (keep.length === current.length) continue;
		cut = true;
		if (rows === 0) {
			delete artifact.view;
			artifact.truncated = true;
			continue;
		}
		view.rows = keep;
		artifact.truncated = true;
	}
	return cut;
}
/** Drops every remaining payload view, keeping labels and download links. */
function dropViews(artifacts) {
	let cut = false;
	for (const artifact of artifacts) {
		if (artifact.view === void 0) continue;
		cut = true;
		delete artifact.view;
		artifact.truncated = true;
	}
	return cut;
}
/**
* Projects one execution/read result into the card's payload.
*
* The payload is trimmed deterministically while it exceeds
* {@link MAX_META_CHARS}: rows first (10, then 5, then 2, then none), then the
* payloads themselves, then whole artifacts from the end. Every cut is reported
* through `truncated`/`omittedArtifacts` so a reader never mistakes a trimmed
* result for a complete one.
* @param source - the tool's canonical value.
* @returns the bounded presentation payload.
*/
function runResultMeta(source) {
	const all = source.artifacts ?? [];
	const shown = all.slice(0, 3);
	const artifacts = shown.map((artifact) => {
		const { view, truncated } = artifactView(artifact.inlineText);
		return {
			id: artifact.id,
			label: artifact.label,
			...artifact.mimeType === void 0 ? {} : { mimeType: artifact.mimeType },
			...artifact.accessUrl === void 0 ? {} : { accessUrl: artifact.accessUrl },
			...view === void 0 ? {} : { view },
			...truncated ? { truncated: true } : {}
		};
	});
	const meta = {
		v: 1,
		...source.runId === void 0 ? {} : { runId: source.runId },
		status: source.status ?? "unknown",
		...source.pending === true ? { pending: true } : {},
		counts: {
			total: source.totalRows ?? 0,
			completed: source.completedRows ?? 0,
			failed: source.failedRows ?? 0
		},
		...source.currency === void 0 ? {} : { currency: source.currency },
		artifacts,
		...all.length > shown.length ? { omittedArtifacts: all.length - shown.length } : {}
	};
	const size = () => JSON.stringify(meta).length;
	let cut = false;
	for (const rows of [
		10,
		5,
		2,
		0
	]) {
		if (size() <= MAX_META_CHARS) break;
		if (capRows(artifacts, rows)) cut = true;
	}
	if (size() > MAX_META_CHARS && dropViews(artifacts)) cut = true;
	while (size() > MAX_META_CHARS && artifacts.length > 0) {
		artifacts.pop();
		meta.omittedArtifacts = (meta.omittedArtifacts ?? 0) + 1;
		cut = true;
	}
	if (cut || size() > MAX_META_CHARS) meta.truncated = true;
	return { ...meta };
}
//#endregion
//#region src/market/tools.ts
const SKILLBOT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		name: {
			type: "string",
			required: true
		},
		description: {
			type: "string",
			required: true
		},
		available: {
			type: "boolean",
			required: true
		},
		fixedFee: { type: "string" },
		versionId: { type: "string" }
	}
};
function skillbotValue(skillbot) {
	return {
		id: skillbot.id,
		name: skillbot.name,
		description: skillbot.description,
		available: skillbot.available,
		...skillbot.fixedFee === void 0 ? {} : { fixedFee: skillbot.fixedFee },
		...skillbot.versionId === void 0 ? {} : { versionId: skillbot.versionId }
	};
}
function quoteValue(quote) {
	return {
		estimatedBuyerPayable: quote.estimatedBuyerPayable,
		...quote.currency === void 0 ? {} : { currency: quote.currency },
		...quote.taskFixedFee === void 0 ? {} : { taskFixedFee: quote.taskFixedFee }
	};
}
function draftValue(draft) {
	return {
		draftId: draft.id,
		expiresAt: draft.expiresAt,
		rowCount: draft.rowCount,
		skillbot: skillbotValue(draft.skillbot),
		quote: quoteValue(draft.quote)
	};
}
function executionResultValue(receipt, poll, result) {
	const value = {
		draftId: receipt.draftId,
		accepted: receipt.accepted,
		...receipt.runId === void 0 ? {} : { runId: receipt.runId },
		...receipt.status === void 0 ? {} : { status: receipt.status }
	};
	if (poll !== void 0) {
		value.status = poll.status;
		value.pending = poll.pending;
		value.pollAttempts = poll.attempts;
	}
	if (result !== void 0) {
		value.totalRows = result.totalRows;
		value.completedRows = result.completedRows;
		value.failedRows = result.failedRows;
		value.artifacts = result.artifacts.map((artifact) => ({
			id: artifact.id,
			label: artifact.label,
			...artifact.mimeType === void 0 ? {} : { mimeType: artifact.mimeType },
			...artifact.accessUrl === void 0 ? {} : { accessUrl: artifact.accessUrl },
			...artifact.inlineText === void 0 ? {} : { inlineText: artifact.inlineText }
		}));
	}
	return value;
}
function asString(value, field) {
	if (typeof value !== "string" || value.trim() === "") throw new LoomApiError(400, `${field} is required`);
	return value.trim();
}
function requireAgent(agent) {
	if (agent === void 0) throw new LoomApiError(503, "Loomloom execution is available only inside an active DSH chat session");
	return agent;
}
function registerLoomTools(ctx, service) {
	const disposers = [
		ctx.tools.register(defineTool({
			name: "loomloom_list_skillbots",
			description: "List the first page of available Loomloom SkillBots for fast browsing. When a keyword is provided, scan the bounded market dataset and match locally by title, description and id.",
			parameters: { keyword: {
				type: "string",
				description: "Optional keyword matched locally against the full dataset (listing title, description and id; case-insensitive; multiple whitespace-separated terms are ranked by how many match)."
			} },
			output: {
				schema: {
					type: "array",
					items: SKILLBOT_SCHEMA
				},
				render: (_args, value) => [{
					type: "text",
					text: value.length === 0 ? "No available Loomloom SkillBots were found." : value.map((skillbot) => `${skillbot.name} (${skillbot.id})${skillbot.fixedFee === void 0 ? "" : ` — fixed fee ${skillbot.fixedFee}`}`).join("\n")
				}]
			},
			async execute(args, exec) {
				const options = {};
				if (typeof args.keyword === "string") options.keyword = args.keyword;
				return (await service.list(exec.signal, options)).map(skillbotValue);
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_get_skillbot",
			description: "Get one Loomloom SkillBot including its input fields. Use before preparing an execution and ask the user for any missing required input.",
			parameters: { listing_id: {
				type: "string",
				required: true,
				description: "Opaque SkillBot listing id returned by loomloom_list_skillbots."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						skillbot: {
							...SKILLBOT_SCHEMA,
							required: true
						},
						fields: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									key: {
										type: "string",
										required: true
									},
									label: {
										type: "string",
										required: true
									},
									required: {
										type: "boolean",
										required: true
									},
									valueType: {
										type: "string",
										required: true
									},
									description: { type: "string" },
									enumValues: {
										type: "array",
										items: { type: "string" }
									}
								}
							}
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `${value.skillbot.name} accepts: ${value.fields.map((field) => `${field.key}${field.required ? " (required)" : ""}`).join(", ") || "no declared fields"}`
				}]
			},
			async execute(args, exec) {
				const detail = await service.get(asString(args.listing_id, "listing_id"), exec.signal);
				return {
					skillbot: skillbotValue(detail),
					fields: detail.fields.map((field) => ({
						key: field.key,
						label: field.label,
						required: field.required,
						valueType: field.valueType,
						...field.description === void 0 ? {} : { description: field.description },
						...field.enumValues === void 0 ? {} : { enumValues: [...field.enumValues] }
					}))
				};
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_prepare_execution",
			description: "Validate Loomloom SkillBot inputs and create a short-lived execution draft. This tool has no side effect and never starts a paid run.",
			parameters: {
				listing_id: {
					type: "string",
					required: true,
					description: "Opaque SkillBot listing id."
				},
				input_rows: {
					type: "json",
					required: true,
					description: "An array of 1-100 input objects matching the SkillBot input schema."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						draftId: {
							type: "string",
							required: true
						},
						expiresAt: {
							type: "string",
							required: true
						},
						rowCount: {
							type: "integer",
							required: true
						},
						skillbot: {
							...SKILLBOT_SCHEMA,
							required: true
						},
						quote: {
							type: "object",
							required: true,
							additionalProperties: false,
							properties: {
								estimatedBuyerPayable: {
									type: "string",
									required: true
								},
								currency: { type: "string" },
								taskFixedFee: { type: "string" }
							}
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `Prepared ${value.rowCount} row(s) for ${value.skillbot.name}. Market estimate: ${value.quote.estimatedBuyerPayable}${value.quote.currency === void 0 ? " (currency unknown)" : ` ${value.quote.currency}`}. Do NOT reuse the listing id: the execution draft id is ${value.draftId}. Ask the user to confirm before calling loomloom_execute_skillbot with draft_id=${value.draftId}. Draft expires at ${value.expiresAt}.`
				}]
			},
			async execute(args, exec) {
				return draftValue(await service.prepare(requireAgent(exec.agent), asString(args.listing_id, "listing_id"), args.input_rows, exec.signal));
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_execute_skillbot",
			description: "Request explicit user approval and, only when approved, execute a prepared Loomloom SkillBot draft. This may incur a fee.",
			parameters: { draft_id: {
				type: "string",
				required: true,
				description: "Short-lived draftId returned by loomloom_prepare_execution."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						draftId: {
							type: "string",
							required: true
						},
						accepted: {
							type: "boolean",
							required: true
						},
						runId: { type: "string" },
						status: { type: "string" },
						pending: { type: "boolean" },
						pollAttempts: { type: "integer" },
						totalRows: { type: "integer" },
						completedRows: { type: "integer" },
						failedRows: { type: "integer" },
						artifacts: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									id: {
										type: "string",
										required: true
									},
									label: {
										type: "string",
										required: true
									},
									mimeType: { type: "string" },
									accessUrl: { type: "string" },
									inlineText: { type: "string" }
								}
							}
						}
					}
				},
				render: (_args, value) => {
					const blocks = [{
						type: "text",
						text: value.runId === void 0 ? "Loomloom accepted the execution request." : value.pending === true ? `Loomloom accepted the execution request. Run ID: ${value.runId} is still ${value.status ?? "pending"}; polling stopped before completion.` : `Loomloom run ${value.runId} finished with status ${value.status ?? "unknown"}${value.completedRows === void 0 ? "" : ` (${value.completedRows}/${value.totalRows} rows completed, ${value.failedRows} failed)`}.`
					}];
					for (const artifact of value.artifacts ?? []) {
						if (typeof artifact.inlineText !== "string" || artifact.inlineText.trim() === "") continue;
						blocks.push({
							type: "text",
							text: `--- ${artifact.label} ---\n${artifact.inlineText}`
						});
					}
					return blocks;
				},
				presentationMeta: (_args, value) => runResultMeta(value)
			},
			async execute(args, exec) {
				const agent = requireAgent(exec.agent);
				const draftId = asString(args.draft_id, "draft_id");
				const draft = service.describeDraft(draftId, agent);
				if (draft === void 0) throw new LoomApiError(404, `execution draft "${draftId}" is unavailable or expired (it must be the draft_id returned by loomloom_prepare_execution, not the listing id)`);
				const approval = ctx.get("approval");
				if (approval === void 0) throw new LoomApiError(503, "DSH user approval is unavailable; execution is blocked");
				const estimate = `${draft.quote.estimatedBuyerPayable}${draft.quote.currency === void 0 ? " (currency unknown)" : ` ${draft.quote.currency}`}`;
				if (await approval.request({
					agent: exec.agent,
					toolName: "loomloom_execute_skillbot",
					callId: exec.callId,
					reason: `Execute ${draft.skillbot.name} for ${draft.rowCount} row(s). Market estimate: ${estimate}.`,
					signal: exec.signal
				}) !== "allowed-once") throw new LoomApiError(403, "Loomloom execution was not approved by the user");
				const receipt = await service.execute(agent, draftId, exec.signal);
				if (receipt.runId === void 0) return executionResultValue(receipt, void 0, void 0);
				const poll = await service.pollRunUntilTerminal(receipt.runId, {}, exec.signal);
				if (!poll.terminal) return executionResultValue(receipt, poll, void 0);
				return executionResultValue(receipt, poll, await service.getRunResults(receipt.runId, exec.signal));
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_get_run",
			description: "Get the current status and display name of a Loomloom SkillBot run.",
			parameters: { run_id: {
				type: "string",
				required: true,
				description: "Opaque Loomloom run id."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						runId: {
							type: "string",
							required: true
						},
						status: {
							type: "string",
							required: true
						},
						displayName: {
							type: "string",
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `${value.displayName}: ${value.status} (${value.runId})`
				}]
			},
			execute(args, exec) {
				return service.getRun(asString(args.run_id, "run_id"), exec.signal);
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_get_run_results",
			description: "Get a Loomloom run result summary and its output artifacts after or while a SkillBot run completes. Do not expose input rows.",
			parameters: { run_id: {
				type: "string",
				required: true,
				description: "Opaque Loomloom run id."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						runId: {
							type: "string",
							required: true
						},
						status: {
							type: "string",
							required: true
						},
						totalRows: {
							type: "integer",
							required: true
						},
						completedRows: {
							type: "integer",
							required: true
						},
						failedRows: {
							type: "integer",
							required: true
						},
						artifacts: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									id: {
										type: "string",
										required: true
									},
									label: {
										type: "string",
										required: true
									},
									mimeType: { type: "string" },
									accessUrl: { type: "string" },
									inlineText: {
										type: "string",
										description: "The artifact content. JSON output is rendered as a table on the card."
									}
								}
							}
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: [`${value.status}: ${value.completedRows}/${value.totalRows} completed, ${value.failedRows} failed.`, renderArtifacts(value.artifacts)].join("\n\n")
				}],
				presentationMeta: (_args, value) => runResultMeta(value)
			},
			async execute(args, exec) {
				const result = await service.getRunResults(asString(args.run_id, "run_id"), exec.signal);
				return {
					runId: result.runId,
					status: result.status,
					totalRows: result.totalRows,
					completedRows: result.completedRows,
					failedRows: result.failedRows,
					artifacts: result.artifacts.map((artifact) => ({
						id: artifact.id,
						label: artifact.label,
						...artifact.mimeType === void 0 ? {} : { mimeType: artifact.mimeType },
						...artifact.accessUrl === void 0 ? {} : { accessUrl: artifact.accessUrl },
						...artifact.inlineText === void 0 ? {} : { inlineText: artifact.inlineText }
					}))
				};
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_get_balance",
			description: "Read the current Loomloom settled balance snapshot for the signed-in account. Use it before preparing a paid execution when cost matters.",
			parameters: {},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						currency: { type: "string" },
						availableBalance: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.availableBalance === void 0 ? "Loomloom did not return an available balance." : `Available balance: ${value.availableBalance}${value.currency === void 0 ? " (currency unknown)" : ` ${value.currency}`}`
				}]
			},
			async execute(_args, exec) {
				const balance = await service.getBalance(exec.signal);
				return {
					...balance.currency === void 0 ? {} : { currency: balance.currency },
					...balance.availableBalance === void 0 ? {} : { availableBalance: balance.availableBalance }
				};
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_list_my_listings",
			description: "List the Market listings owned by the signed-in creator account, including sale status, review status and fixed fee. Read-only.",
			parameters: {},
			output: {
				schema: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							id: {
								type: "string",
								required: true
							},
							name: {
								type: "string",
								required: true
							},
							description: {
								type: "string",
								required: true
							},
							available: {
								type: "boolean",
								required: true
							},
							status: { type: "string" },
							saleStatus: { type: "string" },
							fixedFee: { type: "string" },
							currency: { type: "string" },
							listingVersionId: { type: "string" },
							publishedVersionId: { type: "string" },
							reviewStatus: { type: "string" },
							reviewReason: { type: "string" }
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.length === 0 ? "This account owns no Market listings." : value.map((listing) => `${listing.name} (${listing.id})${listing.saleStatus === void 0 ? "" : ` — ${listing.saleStatus}`}${listing.reviewStatus === void 0 ? "" : ` / review ${listing.reviewStatus}`}${listing.fixedFee === void 0 ? "" : ` — fixed fee ${listing.fixedFee}`}`).join("\n")
				}]
			},
			async execute(_args, exec) {
				return (await service.listMyListings(exec.signal)).map((listing) => ({
					id: listing.id,
					name: listing.name,
					description: listing.description,
					available: listing.available,
					...listing.status === void 0 ? {} : { status: listing.status },
					...listing.saleStatus === void 0 ? {} : { saleStatus: listing.saleStatus },
					...listing.fixedFee === void 0 ? {} : { fixedFee: listing.fixedFee },
					...listing.currency === void 0 ? {} : { currency: listing.currency },
					...listing.listingVersionId === void 0 ? {} : { listingVersionId: listing.listingVersionId },
					...listing.publishedVersionId === void 0 ? {} : { publishedVersionId: listing.publishedVersionId },
					...listing.reviewStatus === void 0 ? {} : { reviewStatus: listing.reviewStatus },
					...listing.reviewReason === void 0 ? {} : { reviewReason: listing.reviewReason }
				}));
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_list_creator_transactions",
			description: "List the signed-in creator account Market transactions (who ran which listing and the associated fees). Read-only.",
			parameters: {},
			output: {
				schema: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							runTransactionId: { type: "string" },
							runId: { type: "string" },
							listingId: { type: "string" },
							skillName: { type: "string" },
							taskFixedFee: { type: "string" },
							finalBuyerPayable: { type: "string" },
							currency: { type: "string" },
							transactionStatus: { type: "string" }
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.length === 0 ? "This account has no Market transactions." : value.map((transaction) => `${transaction.skillName ?? transaction.listingId ?? "transaction"}${transaction.transactionStatus === void 0 ? "" : ` — ${transaction.transactionStatus}`}${transaction.taskFixedFee === void 0 ? "" : ` — fee ${transaction.taskFixedFee}`}${transaction.runId === void 0 ? "" : ` (run ${transaction.runId})`}`).join("\n")
				}]
			},
			async execute(_args, exec) {
				return (await service.listCreatorTransactions(exec.signal)).map((transaction) => ({
					...transaction.runTransactionId === void 0 ? {} : { runTransactionId: transaction.runTransactionId },
					...transaction.runId === void 0 ? {} : { runId: transaction.runId },
					...transaction.listingId === void 0 ? {} : { listingId: transaction.listingId },
					...transaction.skillName === void 0 ? {} : { skillName: transaction.skillName },
					...transaction.taskFixedFee === void 0 ? {} : { taskFixedFee: transaction.taskFixedFee },
					...transaction.finalBuyerPayable === void 0 ? {} : { finalBuyerPayable: transaction.finalBuyerPayable },
					...transaction.currency === void 0 ? {} : { currency: transaction.currency },
					...transaction.transactionStatus === void 0 ? {} : { transactionStatus: transaction.transactionStatus }
				}));
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_publish_listing",
			description: "Publish a creator template version as a Market listing for review. This writes to the account and starts a review; ask the user for the display name, template ids and fixed fee before calling it.",
			parameters: {
				display_name: {
					type: "string",
					required: true,
					description: "Public listing display name shown in the Market."
				},
				template_id: {
					type: "string",
					required: true,
					description: "Template id to publish."
				},
				template_version_id: {
					type: "string",
					required: true,
					description: "Template version id to publish."
				},
				task_fixed_fee: {
					type: "number",
					required: true,
					description: "Creator fixed fee per billable task, in currency units (for example 0.5)."
				},
				description: {
					type: "string",
					description: "Optional listing description."
				},
				listing_id: {
					type: "string",
					description: "Optional existing listing id when publishing a new version of it."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						id: {
							type: "string",
							required: true
						},
						status: { type: "string" },
						reviewStatus: { type: "string" },
						reviewRequestId: { type: "string" },
						name: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `Published listing ${value.id}${value.name === void 0 ? "" : ` (${value.name})`}${value.status === void 0 ? "" : ` with status ${value.status}`}${value.reviewStatus === void 0 ? "" : `; review ${value.reviewStatus}`}${value.reviewRequestId === void 0 ? "" : `; review request ${value.reviewRequestId}`}.`
				}]
			},
			async execute(args, exec) {
				const fee = args.task_fixed_fee;
				if (typeof fee !== "number") throw new LoomApiError(400, "task_fixed_fee is required");
				requireAgent(exec.agent);
				const approval = ctx.get("approval");
				if (approval === void 0) throw new LoomApiError(503, "DSH user approval is unavailable; publishing is blocked");
				const displayName = asString(args.display_name, "display_name");
				const templateId = asString(args.template_id, "template_id");
				const templateVersionId = asString(args.template_version_id, "template_version_id");
				const listingId = typeof args.listing_id === "string" && args.listing_id.trim() !== "" ? args.listing_id.trim() : void 0;
				const action = listingId === void 0 ? "Create a new Market listing" : `Update Market listing ${listingId}`;
				if (await approval.request({
					agent: exec.agent,
					toolName: "loomloom_publish_listing",
					callId: exec.callId,
					reason: `${action} using template ${templateId}, version ${templateVersionId}, display name "${displayName}", and fixed fee ${fee}. This submits the change for review.`,
					signal: exec.signal
				}) !== "allowed-once") throw new LoomApiError(403, "Loomloom listing publication was not approved by the user");
				const published = await service.publishListing({
					displayName,
					templateId,
					templateVersionId,
					taskFixedFee: fee,
					...typeof args.description === "string" ? { description: args.description } : {},
					...typeof args.listing_id === "string" ? { listingId: args.listing_id } : {}
				}, exec.signal);
				return {
					id: published.id,
					...published.status === void 0 ? {} : { status: published.status },
					...published.reviewStatus === void 0 ? {} : { reviewStatus: published.reviewStatus },
					...published.reviewRequestId === void 0 ? {} : { reviewRequestId: published.reviewRequestId },
					...published.name === void 0 ? {} : { name: published.name }
				};
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_list_official_templates",
			description: "List the official (first-party) Loomloom templates that can be run or published. Use it to find a template id before reading its schema.",
			parameters: {},
			output: {
				schema: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							templateId: {
								type: "string",
								required: true
							},
							name: {
								type: "string",
								required: true
							},
							scenario: { type: "string" },
							inputSummary: { type: "string" },
							outputType: { type: "string" },
							version: { type: "string" }
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.length === 0 ? "No official Loomloom templates were found." : value.map((template) => `${template.name} (${template.templateId})${template.scenario === void 0 ? "" : ` — ${template.scenario}`}${template.outputType === void 0 ? "" : ` → ${template.outputType}`}`).join("\n")
				}]
			},
			async execute(_args, exec) {
				return (await service.listOfficialTemplates(exec.signal)).map((template) => ({
					templateId: template.templateId,
					name: template.name,
					...template.scenario === void 0 ? {} : { scenario: template.scenario },
					...template.inputSummary === void 0 ? {} : { inputSummary: template.inputSummary },
					...template.outputType === void 0 ? {} : { outputType: template.outputType },
					...template.version === void 0 ? {} : { version: template.version }
				}));
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_get_template_schema",
			description: "Read one official Loomloom template input schema, including every declared field and its hint. Use it before running or publishing that template.",
			parameters: { template_id: {
				type: "string",
				required: true,
				description: "Official template id returned by loomloom_list_official_templates."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						templateId: {
							type: "string",
							required: true
						},
						name: { type: "string" },
						description: { type: "string" },
						scenario: { type: "string" },
						outputType: { type: "string" },
						fields: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									key: {
										type: "string",
										required: true
									},
									label: {
										type: "string",
										required: true
									},
									required: {
										type: "boolean",
										required: true
									},
									valueType: {
										type: "string",
										required: true
									},
									inputHint: { type: "string" },
									enumValues: {
										type: "array",
										items: { type: "string" }
									},
									examples: {
										type: "array",
										items: { type: "string" }
									}
								}
							}
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `${value.name ?? value.templateId} accepts: ${value.fields.map((field) => `${field.key}${field.required ? " (required)" : ""}`).join(", ") || "no declared fields"}`
				}]
			},
			async execute(args, exec) {
				const schema = await service.getTemplateSchema(asString(args.template_id, "template_id"), exec.signal);
				return {
					templateId: schema.templateId,
					fields: schema.fields.map((field) => ({
						key: field.key,
						label: field.label,
						required: field.required,
						valueType: field.valueType,
						...field.inputHint === void 0 ? {} : { inputHint: field.inputHint },
						...field.enumValues === void 0 ? {} : { enumValues: [...field.enumValues] },
						...field.examples === void 0 ? {} : { examples: [...field.examples] }
					})),
					...schema.name === void 0 ? {} : { name: schema.name },
					...schema.description === void 0 ? {} : { description: schema.description },
					...schema.scenario === void 0 ? {} : { scenario: schema.scenario },
					...schema.outputType === void 0 ? {} : { outputType: schema.outputType }
				};
			}
		})),
		ctx.tools.register(defineTool({
			name: "loomloom_list_my_templates",
			description: "List the private (creator-authored) templates owned by the signed-in account, including the version id required to publish a Market listing. Read-only.",
			parameters: {},
			output: {
				schema: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							templateId: {
								type: "string",
								required: true
							},
							name: {
								type: "string",
								required: true
							},
							description: { type: "string" },
							status: { type: "string" },
							latestVersionId: { type: "string" },
							publishedVersionId: { type: "string" },
							outputType: { type: "string" }
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.length === 0 ? "This account owns no private templates." : value.map((template) => `${template.name} (${template.templateId})${template.status === void 0 ? "" : ` — ${template.status}`}${template.latestVersionId === void 0 ? "" : ` — latest version ${template.latestVersionId}`}`).join("\n")
				}]
			},
			async execute(_args, exec) {
				return (await service.listMyTemplates(exec.signal)).map((template) => ({
					templateId: template.templateId,
					name: template.name,
					...template.description === void 0 ? {} : { description: template.description },
					...template.status === void 0 ? {} : { status: template.status },
					...template.latestVersionId === void 0 ? {} : { latestVersionId: template.latestVersionId },
					...template.publishedVersionId === void 0 ? {} : { publishedVersionId: template.publishedVersionId },
					...template.outputType === void 0 ? {} : { outputType: template.outputType }
				}));
			}
		}))
	];
	return () => disposers.forEach((dispose) => dispose());
}
//#endregion
//#region src/market/index.ts
const LOOMLOOM_INTERACTION_POLICY = [
	"When the user asks to invoke a Loomloom SkillBot, follow the SkillBot input protocol exactly:",
	"1. Call loomloom_get_skillbot first and use its returned fields, required flags, descriptions and enum values as the source of truth.",
	"2. If no input row was supplied, or any required field is missing, call ask_user_question. Do not ask the same questions as ordinary assistant prose, skip the interaction, invent values or guess answers.",
	"3. Wait for ask_user_question to return and map its answers into input_rows. Do not call loomloom_prepare_execution before the answers are returned.",
	"4. Call loomloom_prepare_execution only after the inputs are complete. Report the quote and wait for explicit user approval before calling loomloom_execute_skillbot.",
	"5. If ask_user_question is unavailable, state that interactive input is unavailable and stop the SkillBot flow; do not fall back to plain-text questions or continue execution."
].join("\n");
function mountMarket(ctx, config = {}) {
	const resolved = resolveLoomConfig(config);
	const resolveToken = createLoomTokenResolver(ctx, resolved);
	const resolveIdentityToken = createLoomIdentityTokenResolver(ctx);
	const readCredentialStatus = createLoomCredentialStatusReader(ctx, resolved);
	const api = new LoomApi(resolved, resolveToken);
	const skillbots = new LoomSkillbotService(api);
	const browserLogin = new LoomBrowserLoginService(ctx, resolved);
	const creatorKey = envSecret(process.env, resolved.creatorKeyEnv);
	const storefrontSource = storefrontSourceFor(resolved, creatorKey);
	if (resolved.creatorKeyEnv !== void 0 && creatorKey === void 0) ctx.logger.warn(`loomloom: creatorKeyEnv is "${resolved.creatorKeyEnv}" but that environment variable is not set; using the public Market catalogue`);
	const creatorApi = creatorKey === void 0 ? null : new LoomApi(resolved, async () => creatorKey);
	const publicApi = new LoomApi(resolved, async () => void 0);
	ctx.logger.info(`loomloom: storefront source=${storefrontSource} pinned=${String(resolved.storefrontListingIds.length)}` + (resolved.creatorKeyEnv === void 0 ? "" : ` creatorKeyEnv=${resolved.creatorKeyEnv}`));
	ctx.effect(() => ctx.systemPrompt.section({
		name: "loomloom:interaction-policy",
		order: 2950,
		text: LOOMLOOM_INTERACTION_POLICY
	}), "loomloom: interaction policy");
	ctx.effect(() => {
		const disposeRoutes = registerLoomRoutes(ctx, api, readCredentialStatus, browserLogin, () => clearLoomToken(ctx, resolved), createLoomBootstrapReader(ctx, resolved, readCredentialStatus, resolveToken), createLoomAccountReaderWithToken(api, resolveToken, resolveIdentityToken), {
			storefront: createStorefrontCache(ctx, createStorefrontReader(publicApi, resolved, storefrontSource === "public" ? { publicMarket: true } : storefrontSource === "creator" ? { creator: creatorApi } : {}), {
				configured: true,
				cacheKey: storefrontCacheKey(resolved, creatorKey)
			}),
			storefrontSource,
			skillbots,
			skillRoot: () => resolveDefaultSkillRoot()
		});
		return async () => {
			disposeRoutes();
			await browserLogin.dispose();
		};
	}, "loomloom: host routes");
	ctx.effect(() => registerLoomTools(ctx, skillbots), "loomloom: DSH tools");
	ctx.effect(() => registerLoomAuthorization(ctx, resolved), "loomloom: credential authorization");
}
//#endregion
//#region src/routes.ts
const MAX_JSON_BYTES = 32 * 1024;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]{1,200}$/;
function sendJson(res, status, value) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-content-type-options", "nosniff");
	res.end(JSON.stringify(value));
}
function sameAuthority(req, port) {
	const host = req.headers.host?.toLowerCase();
	return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}
function allowed(req, res, port) {
	if (!sameAuthority(req, port)) {
		sendJson(res, 403, { error: "只接受本机请求" });
		return false;
	}
	if (req.method === "GET" || req.method === "HEAD") return true;
	const host = req.headers.host?.toLowerCase();
	if (host !== void 0 && req.headers.origin === `http://${host}`) return true;
	sendJson(res, 403, { error: "只接受本机请求" });
	return false;
}
async function readJson(req) {
	if (!/^application\/json(?:\s*;|$)/iu.test(req.headers["content-type"] ?? "")) throw new ShengsuanyunError(415, "请求必须是 JSON", "invalid-request");
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		const bytes = Buffer.from(chunk);
		size += bytes.byteLength;
		if (size > MAX_JSON_BYTES) throw new ShengsuanyunError(413, "请求过大", "invalid-request");
		chunks.push(bytes);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("shape");
		return value;
	} catch (cause) {
		if (cause instanceof ShengsuanyunError) throw cause;
		throw new ShengsuanyunError(400, "请求必须是 JSON 对象", "invalid-request");
	}
}
function fail(res, cause) {
	if (cause instanceof ShengsuanyunError) {
		sendJson(res, cause.status >= 400 && cause.status < 600 ? cause.status : 502, {
			error: cause.message,
			reason: cause.reason
		});
		return;
	}
	sendJson(res, 400, {
		error: "请求没有完成",
		reason: "invalid-request"
	});
}
function useAsDefault(body) {
	return body.useAsDefault !== false;
}
function registerRoutes(ctx, login) {
	const port = ctx.webServer.port;
	const register = (path, handler) => ctx.webServer.register({
		kind: "exact",
		path,
		handler
	});
	const routes = [
		register(`${API_PREFIX}/status`, async (req, res) => {
			if (req.method !== "GET" || !allowed(req, res, port)) return;
			try {
				sendJson(res, 200, await login.snapshot(AbortSignal.timeout(8e3)));
			} catch {
				sendJson(res, 503, { error: "暂时读不到胜算云连接状态" });
			}
		}),
		register(`${API_PREFIX}/login/start`, async (req, res) => {
			if (req.method !== "POST" || !allowed(req, res, port)) return;
			try {
				const body = await readJson(req);
				sendJson(res, 200, await login.start(useAsDefault(body)));
			} catch (cause) {
				fail(res, cause);
			}
		}),
		register(`${API_PREFIX}/login/status`, async (req, res) => {
			if (req.method !== "GET" || !allowed(req, res, port)) return;
			const sessionId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("sessionId") ?? "";
			if (!SESSION_PATTERN.test(sessionId)) {
				sendJson(res, 400, { error: "登录会话无效" });
				return;
			}
			const status = login.status(sessionId);
			if (status === void 0) sendJson(res, 404, { error: "登录会话不存在" });
			else sendJson(res, 200, status);
		}),
		register(`${API_PREFIX}/login/cancel`, async (req, res) => {
			if (req.method !== "POST" || !allowed(req, res, port)) return;
			try {
				const body = await readJson(req);
				const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
				if (!SESSION_PATTERN.test(sessionId)) throw new ShengsuanyunError(400, "登录会话无效", "invalid-request");
				await login.cancel(sessionId);
				sendJson(res, 200, { ok: true });
			} catch (cause) {
				fail(res, cause);
			}
		}),
		register(`${API_PREFIX}/token`, async (req, res) => {
			if (req.method !== "POST" || !allowed(req, res, port)) return;
			try {
				const body = await readJson(req);
				const token = typeof body.token === "string" ? body.token : "";
				sendJson(res, 200, await login.saveToken(token, useAsDefault(body), AbortSignal.timeout(2e4)));
			} catch (cause) {
				fail(res, cause);
			}
		}),
		register(`${API_PREFIX}/model`, async (req, res) => {
			if (req.method !== "POST" || !allowed(req, res, port)) return;
			try {
				const body = await readJson(req);
				const model = typeof body.model === "string" ? body.model.trim() : "";
				if (!MODEL_PATTERN.test(model)) throw new ShengsuanyunError(400, "模型 id 无效", "invalid-request");
				await login.chooseModel(model, AbortSignal.timeout(2e4));
				sendJson(res, 200, { ok: true });
			} catch (cause) {
				fail(res, cause);
			}
		}),
		register(`${API_PREFIX}/logout`, async (req, res) => {
			if (req.method !== "POST" || !allowed(req, res, port)) return;
			try {
				await login.logout();
				sendJson(res, 200, { ok: true });
			} catch (cause) {
				fail(res, cause);
			}
		})
	];
	return () => {
		for (const dispose of routes) dispose();
	};
}
//#endregion
//#region src/index.ts
const name = "shengsuanyun";
const inject = [
	"webServer",
	"credentials",
	"agentDefaultModel",
	"settings"
];
function apply(ctx) {
	const login = new ShengsuanyunLogin(ctx);
	ctx.effect(() => {
		ensureProvider(ctx).catch((error) => {
			ctx.logger.error("shengsuanyun: provider route was not declared");
			ctx.logger.error(error);
		});
		const disposeRoutes = registerRoutes(ctx, login);
		return async () => {
			disposeRoutes();
			await login.dispose();
		};
	}, "shengsuanyun: configuration");
	ctx.inject([
		"tools",
		"systemPrompt",
		"authorization"
	], (marketCtx) => {
		mountMarket(marketCtx);
	});
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map