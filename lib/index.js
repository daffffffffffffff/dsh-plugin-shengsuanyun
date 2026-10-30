import { createHash, randomBytes } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { createServer } from "node:http";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region src/constants.ts
const PROVIDER = "shengsuanyun";
const DISPLAY_NAME = "胜算云";
const API_KEY_ENV = "SHENGSUANYUN_API_KEY";
const DEFAULT_MODEL = "deepseek-v4-flash";
const ROUTER_BASE_URL = "https://router.shengsuanyun.com/api/v1";
const ROUTER_MODELS_URL = `${ROUTER_BASE_URL}/models`;
const AUTH_PAGE_URL = "https://router.shengsuanyun.com/auth";
const ACCOUNT_KEYS_URL = "https://api.shengsuanyun.com/auth/keys";
const ACCOUNT_INFO_URL = "https://api.shengsuanyun.com/user/info";
/** App channel the ShengSuanYun authorization page expects. */
const AUTH_CHANNEL = "CH_B51KXQ98";
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
const MAX_EXCHANGE_BYTES = 64 * 1024;
const AUTH_TIMEOUT_MS = 5 * 6e4;
function successCode(value) {
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
	authorize.searchParams.set("from", AUTH_CHANNEL);
	authorize.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
	authorize.searchParams.set("code_challenge_method", "S256");
	authorize.searchParams.set("state", state);
	return authorize.toString();
}
function callbackPage(res, ok) {
	const title = ok ? "正在验证授权" : "授权失败";
	const heading = ok ? "授权信息已收到" : "授权未完成";
	const detail = ok ? "dsh 正在验证并保存 API Key，请回到 dsh 查看结果。" : "请回到 dsh 后重新登录。";
	res.statusCode = ok ? 200 : 400;
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-content-type-options", "nosniff");
	res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><body><main><h1>${heading}</h1><p>${detail}</p></main></body></html>`);
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
	if (address === null || typeof address === "string") throw new Error("胜算云回调没有绑到本机端口");
	return address.port;
}
async function closeServer(server) {
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
		throw new ShengsuanyunError(502, "胜算云授权服务暂时不可用", "router-validation-failed");
	}
	const body = await response.text();
	if (body.length > MAX_EXCHANGE_BYTES) throw new ShengsuanyunError(502, "胜算云授权响应过大", "router-validation-failed");
	if (!response.ok) throw new ShengsuanyunError(response.status, "胜算云授权码兑换失败", "router-validation-failed");
	let payload;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new ShengsuanyunError(502, "胜算云授权响应无效", "router-validation-failed");
	}
	if (!successCode(payload.code)) throw new ShengsuanyunError(502, "胜算云授权码兑换失败", "router-validation-failed");
	const value = credentialFromEnvelope(payload);
	if (value === void 0) throw new ShengsuanyunError(502, "胜算云授权未返回有效凭据", "router-validation-failed");
	return value;
}
/** One loopback login. The verifier stays in this process. */
async function beginBrowserAuthorization(signal) {
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
			callbackPage(res, false);
			return;
		}
		if (requestUrl.searchParams.get("state") !== state) {
			callbackPage(res, false);
			return;
		}
		if (requestUrl.searchParams.get("error") !== null) {
			consumed = true;
			callbackPage(res, false);
			reject(new ShengsuanyunError(400, "胜算云授权已取消", "authorization-cancelled"));
			return;
		}
		const code = requestUrl.searchParams.get("code");
		if (code === null || code.trim() === "") {
			callbackPage(res, false);
			return;
		}
		consumed = true;
		callbackPage(res, true);
		exchangeCode(code, verifier, callbackUrl, signal, ACCOUNT_KEYS_URL).then(settle, reject);
	});
	callbackUrl = `http://127.0.0.1:${await listen(server)}/callback?state=${encodeURIComponent(state)}`;
	const timeout = setTimeout(() => reject(new ShengsuanyunError(408, "等待胜算云浏览器授权超时", "authorization-timeout")), AUTH_TIMEOUT_MS);
	const abort = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
	signal.addEventListener("abort", abort, { once: true });
	result.finally(async () => {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
		await closeServer(server);
	}).catch(() => {});
	return {
		url: authorizeUrl(AUTH_PAGE_URL, callbackUrl, state, verifier),
		result
	};
}
//#endregion
//#region src/account.ts
const MAX_ACCOUNT_RESPONSE_BYTES = 256 * 1024;
const IDENTITY_FIELDS = [
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
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function text(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim();
	return normalized === "" ? void 0 : normalized;
}
function userRecord(payload) {
	const queue = [payload];
	const visited = /* @__PURE__ */ new Set();
	while (queue.length > 0) {
		const candidate = queue.shift();
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) || visited.has(candidate)) continue;
		visited.add(candidate);
		const current = candidate;
		if (IDENTITY_FIELDS.some((field) => field in current)) return current;
		for (const key of ENVELOPES) queue.push(current[key]);
	}
	return {};
}
/** Display name from the account payload. Anything else stays on the host. */
function accountDisplayName(payload) {
	const user = userRecord(payload);
	return text(user.displayName ?? user.display_name ?? user.name ?? user.Nickname ?? user.nickname ?? user.Username ?? user.username);
}
async function boundedBody$1(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_ACCOUNT_RESPONSE_BYTES) {
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
		if (size > MAX_ACCOUNT_RESPONSE_BYTES) {
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
		const envelope = record(payload);
		if (typeof envelope.code === "number" && envelope.code !== 0) return void 0;
		return accountDisplayName(payload);
	} catch {
		return;
	}
}
//#endregion
//#region src/flow.ts
function maskToken(token) {
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
const MAX_ROUTER_MODELS_BYTES = 2 * 1024 * 1024;
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
/** Chat model ids from a ShengSuanYun router `/models` payload. */
function routerModelIds(payload) {
	if (typeof payload !== "object" || payload === null || !Array.isArray(payload.data)) throw new ShengsuanyunError(502, "胜算云模型目录响应无效", "router-validation-failed");
	const ids = payload.data.flatMap((item) => {
		if (typeof item !== "object" || item === null) return [];
		const record = item;
		if (!supportsChatCompletions(record)) return [];
		const id = record.id;
		return typeof id === "string" && id.trim() !== "" ? [id.trim()] : [];
	});
	if (ids.length === 0) throw new ShengsuanyunError(422, "胜算云账号当前没有可用聊天模型", "no-chat-model");
	return ids;
}
async function boundedBody(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_ROUTER_MODELS_BYTES) {
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
		if (size > MAX_ROUTER_MODELS_BYTES) {
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
		response = await fetch(ROUTER_MODELS_URL, {
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
const SESSION_TTL_MS = 10 * 6e4;
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
		const authorization = await beginBrowserAuthorization(controller.signal);
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
			...token === void 0 ? {} : { maskedToken: maskToken(token) },
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
		}, SESSION_TTL_MS);
		expiryTimer.unref?.();
		const session = {
			id,
			controller,
			previous,
			useAsDefault,
			expiresAt: Date.now() + SESSION_TTL_MS,
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
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map