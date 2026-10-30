window.__ModuleLoader__.load({
	id: "dsh-plugin-shengsuanyun",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/api.ts
		var ShengsuanyunClientError = class extends Error {
			reason;
			constructor(message, reason) {
				super(message);
				this.reason = reason;
				this.name = "ShengsuanyunClientError";
			}
		};
		async function request(path, init = {}) {
			const response = await fetch(path, {
				...init,
				headers: {
					accept: "application/json",
					...init?.body === void 0 ? {} : { "content-type": "application/json" },
					...init?.headers
				}
			});
			let payload;
			try {
				payload = await response.json();
			} catch {
				payload = void 0;
			}
			if (!response.ok) {
				const record = typeof payload === "object" && payload !== null ? payload : {};
				throw new ShengsuanyunClientError(typeof record.error === "string" && record.error.trim() !== "" ? record.error : "请求没有完成", typeof record.reason === "string" ? record.reason : void 0);
			}
			return payload;
		}
		function object(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		async function readStatus(signal) {
			const body = object(await request("/api/shengsuanyun/status", signal === void 0 ? {} : { signal }));
			const model = object(body.model);
			const id = typeof model.id === "string" ? model.id : void 0;
			const chatModels = Array.isArray(body.chatModels) ? body.chatModels.filter((item) => typeof item === "string") : void 0;
			return {
				configured: body.configured === true,
				writable: body.writable !== false,
				...typeof body.maskedToken === "string" ? { maskedToken: body.maskedToken } : {},
				...typeof body.accountName === "string" ? { accountName: body.accountName } : {},
				model: {
					provider: "shengsuanyun",
					...id === void 0 ? {} : { id },
					ready: model.ready === true
				},
				...chatModels === void 0 ? {} : { chatModels }
			};
		}
		async function startLogin(useAsDefault, signal) {
			const body = object(await request("/api/shengsuanyun/login/start", {
				method: "POST",
				body: JSON.stringify({ useAsDefault }),
				...signal === void 0 ? {} : { signal }
			}));
			const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
			const url = typeof body.url === "string" ? body.url : "";
			if (sessionId === "" || url === "") throw new ShengsuanyunClientError("登录没有开始");
			return {
				sessionId,
				url
			};
		}
		async function readLogin(sessionId, signal) {
			const body = object(await request(`/api/shengsuanyun/login/status?sessionId=${encodeURIComponent(sessionId)}`, signal === void 0 ? {} : { signal }));
			const state = body.state;
			if (state !== "pending" && state !== "verifying" && state !== "model-selection-required" && state !== "complete" && state !== "cancelled" && state !== "failed") throw new ShengsuanyunClientError("登录状态无效");
			const models = Array.isArray(body.models) ? body.models.filter((item) => typeof item === "string") : void 0;
			return {
				state,
				...typeof body.reason === "string" ? { reason: body.reason } : {},
				...models === void 0 ? {} : { models }
			};
		}
		async function cancelLogin(sessionId) {
			await request("/api/shengsuanyun/login/cancel", {
				method: "POST",
				body: JSON.stringify({ sessionId })
			});
		}
		async function saveToken(token, useAsDefault) {
			const body = object(await request("/api/shengsuanyun/token", {
				method: "POST",
				body: JSON.stringify({
					token,
					useAsDefault
				})
			}));
			const state = body.state;
			if (state !== "complete" && state !== "model-selection-required" && state !== "failed") throw new ShengsuanyunClientError("保存密钥没有完成");
			const models = Array.isArray(body.models) ? body.models.filter((item) => typeof item === "string") : void 0;
			return {
				state,
				...typeof body.reason === "string" ? { reason: body.reason } : {},
				...models === void 0 ? {} : { models }
			};
		}
		async function chooseModel(model) {
			await request("/api/shengsuanyun/model", {
				method: "POST",
				body: JSON.stringify({ model })
			});
		}
		async function logout$1() {
			await request("/api/shengsuanyun/logout", {
				method: "POST",
				body: "{}"
			});
		}
		function reasonText(reason) {
			switch (reason) {
				case "authorization-cancelled": return "登录已取消";
				case "authorization-timeout": return "登录超时，请重试";
				case "router-validation-failed": return "这把密钥连不上胜算云的聊天模型";
				case "no-chat-model": return "这个账号当前没有可用的聊天模型";
				case "credential-save-failed": return "密钥没能保存";
				default: return "没有完成，请重试";
			}
		}
		//#endregion
		//#region src/client/SettingsSection.tsx
		function messageOf(cause) {
			return cause instanceof Error && cause.message.trim() !== "" ? cause.message : "没有完成，请重试";
		}
		function ShengsuanyunSettings(_props) {
			const [stage, setStage] = (0, react.useState)("loading");
			const [status, setStatus] = (0, react.useState)();
			const [loginState, setLoginState] = (0, react.useState)("pending");
			const [models, setModels] = (0, react.useState)([]);
			const [picked, setPicked] = (0, react.useState)("");
			const [token, setToken] = (0, react.useState)("");
			const [useAsDefault, setUseAsDefault] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)();
			const [blocked, setBlocked] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const sessionRef = (0, react.useRef)();
			const urlRef = (0, react.useRef)();
			const pollRef = (0, react.useRef)();
			const keepSession = (0, react.useRef)(false);
			const errorId = (0, react.useId)();
			const stopPolling = (0, react.useCallback)((cancelRemote) => {
				pollRef.current?.abort();
				pollRef.current = void 0;
				const sessionId = sessionRef.current;
				sessionRef.current = void 0;
				urlRef.current = void 0;
				if (cancelRemote && !keepSession.current && sessionId !== void 0) cancelLogin(sessionId).catch(() => void 0);
			}, []);
			const refresh = (0, react.useCallback)(async () => {
				setStage("loading");
				setError(void 0);
				try {
					const next = await readStatus();
					setStatus(next);
					setPicked(next.chatModels?.[0] ?? next.model.id ?? "");
					if (!next.configured) {
						setStage("unconfigured");
						return;
					}
					if (next.model.id !== void 0 && !next.model.ready) {
						setModels(next.chatModels ?? []);
						setPicked(next.chatModels?.[0] ?? "");
						setStage("model-selection");
						return;
					}
					setStage("connected");
				} catch (cause) {
					setStage("unconfigured");
					setError(messageOf(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			(0, react.useEffect)(() => () => {
				stopPolling(true);
			}, [stopPolling]);
			const poll = (0, react.useCallback)(async (sessionId, controller) => {
				try {
					for (;;) {
						await new Promise((resolve, reject) => {
							const timer = window.setTimeout(resolve, 500);
							controller.signal.addEventListener("abort", () => {
								window.clearTimeout(timer);
								reject(new DOMException("aborted", "AbortError"));
							}, { once: true });
						});
						const next = await readLogin(sessionId, controller.signal);
						setLoginState(next.state);
						if (next.state === "pending" || next.state === "verifying") continue;
						pollRef.current = void 0;
						if (next.state === "complete") {
							sessionRef.current = void 0;
							urlRef.current = void 0;
							keepSession.current = false;
							await refresh();
							return;
						}
						if (next.state === "model-selection-required") {
							keepSession.current = true;
							setModels(next.models ?? []);
							setPicked(next.models?.[0] ?? "");
							setStage("model-selection");
							return;
						}
						sessionRef.current = void 0;
						setStage("unconfigured");
						setError(reasonText(next.reason));
						return;
					}
				} catch (cause) {
					if (cause instanceof DOMException && cause.name === "AbortError") return;
					setStage("unconfigured");
					setError(messageOf(cause));
				}
			}, [refresh]);
			const signIn = (0, react.useCallback)(async () => {
				stopPolling(true);
				keepSession.current = false;
				setError(void 0);
				setBlocked(false);
				setBusy(true);
				try {
					const login = await startLogin(useAsDefault);
					sessionRef.current = login.sessionId;
					urlRef.current = login.url;
					const popup = window.open(login.url, "_blank", "noopener,noreferrer");
					setBlocked(popup === null);
					const controller = new AbortController();
					pollRef.current = controller;
					setLoginState("pending");
					setStage("authorizing");
					poll(login.sessionId, controller);
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			}, [
				poll,
				stopPolling,
				useAsDefault
			]);
			const paste = (0, react.useCallback)(async () => {
				setBusy(true);
				setError(void 0);
				try {
					const result = await saveToken(token, useAsDefault);
					setToken("");
					if (result.state === "model-selection-required") {
						setModels(result.models ?? []);
						setPicked(result.models?.[0] ?? "");
						setStage("model-selection");
						return;
					}
					await refresh();
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			}, [
				refresh,
				token,
				useAsDefault
			]);
			const applyModel = (0, react.useCallback)(async (model) => {
				if (model === "") return;
				setBusy(true);
				setError(void 0);
				try {
					await chooseModel(model);
					keepSession.current = false;
					sessionRef.current = void 0;
					await refresh();
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			}, [refresh]);
			const disconnect = (0, react.useCallback)(async () => {
				setBusy(true);
				setError(void 0);
				try {
					await logout$1();
					await refresh();
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			}, [refresh]);
			const copyLink = (0, react.useCallback)(async () => {
				const url = urlRef.current;
				if (url === void 0) return;
				try {
					await navigator.clipboard.writeText(url);
					setError(void 0);
				} catch {
					setError("没能复制登录链接");
				}
			}, []);
			const locked = status?.configured === true && status.writable === false;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "ssyRoot",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "胜算云" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ssyLead",
						children: "把胜算云接成这个 dsh 的聊天模型。密钥只存在本机凭据里，页面上只显示末四位。"
					})] }),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ssyError",
						id: errorId,
						children: error
					}) : null,
					stage === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ssyNote",
						children: "正在确认连接…"
					}) : null,
					stage === "authorizing" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ssyCard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ssyOk",
								children: loginState === "verifying" ? "正在验证密钥…" : "请在浏览器里完成胜算云登录。"
							}),
							blocked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ssyNote",
								children: "浏览器拦截了新窗口。"
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ssyRow",
								children: [blocked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										copyLink();
									},
									children: "复制登录链接"
								}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										stopPolling(true);
										setStage("unconfigured");
									},
									children: "取消"
								})]
							})
						]
					}) : null,
					stage === "connected" && status !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ssyCard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "ssyOk",
								children: [status.accountName ?? "已连接", status.maskedToken === void 0 ? "" : ` · ${status.maskedToken}`]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ssyNote",
								children: status.model.ready ? `新建对话使用 ${status.model.id ?? "胜算云"}。` : "密钥已保存。新建对话仍用现在的默认模型。"
							}),
							locked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ssyNote",
								children: "密钥来自环境变量 SHENGSUANYUN_API_KEY，这里不能改。"
							}) : null,
							!status.model.ready && (status.chatModels?.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "ssyField",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "改用胜算云模型" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									value: picked,
									onChange: (event) => setPicked(event.target.value),
									children: (status.chatModels ?? []).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: model,
										children: model
									}, model))
								})]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ssyRow",
								children: [!status.model.ready && picked !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "ssyPrimary",
									type: "button",
									disabled: busy,
									onClick: () => {
										applyModel(picked);
									},
									children: "新建对话改用这个模型"
								}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy || locked,
									onClick: () => {
										disconnect();
									},
									children: "断开"
								})]
							})
						]
					}) : null,
					stage === "model-selection" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ssyCard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ssyOk",
								children: "密钥已验证。当前账号里没有默认模型 deepseek-v4-flash，请选一个聊天模型。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "ssyField",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "聊天模型" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									value: picked,
									onChange: (event) => setPicked(event.target.value),
									children: models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: model,
										children: model
									}, model))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ssyRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "ssyPrimary",
									type: "button",
									disabled: busy || picked === "",
									onClick: () => {
										applyModel(picked);
									},
									children: "设为新建对话的模型"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy || locked,
									onClick: () => {
										disconnect();
									},
									children: "断开"
								})]
							})
						]
					}) : null,
					stage === "unconfigured" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ssyCard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "ssyCheck",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: useAsDefault,
									onChange: (event) => setUseAsDefault(event.target.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "连上之后，新建对话改用胜算云的 DeepSeek V4 Flash。已经开着的对话不变。" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ssyRow",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "ssyPrimary",
									type: "button",
									disabled: busy || locked,
									onClick: () => {
										signIn();
									},
									children: "在浏览器中登录胜算云"
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "ssyField",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "或者粘贴 API Key" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "password",
									autoComplete: "off",
									spellCheck: false,
									value: token,
									"aria-describedby": error === void 0 ? void 0 : errorId,
									onChange: (event) => setToken(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ssyRow",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy || locked || token.trim() === "",
									onClick: () => {
										paste();
									},
									children: "保存密钥"
								})
							}),
							locked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ssyNote",
								children: "环境变量 SHENGSUANYUN_API_KEY 已经提供密钥，这里不能再写一把。"
							}) : null
						]
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		const STYLE_ID$1 = "dsh-plugin-shengsuanyun/styles";
		const css$1 = `
.ssyRoot { display: grid; gap: 16px; max-width: 640px; color: var(--dsw-alias-label-primary); }
.ssyRoot h2 { margin: 0; font-size: 20px; line-height: 28px; }
.ssyLead, .ssyNote { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.ssyCard { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.ssyRow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ssyField { display: grid; gap: 6px; }
.ssyField span { font-size: 13px; font-weight: 600; }
.ssyRoot input[type="password"], .ssyRoot select { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-base); color: inherit; font: inherit; }
.ssyRoot button, .ssyLink { padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.ssyPrimary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
.ssyRoot button:disabled { opacity: 0.5; cursor: default; }
.ssyCheck { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 20px; }
.ssyError { margin: 0; color: var(--dsw-alias-state-danger-primary, #b42318); font-size: 13px; line-height: 20px; }
.ssyOk { margin: 0; font-size: 13px; font-weight: 600; }
`;
		function installStyles() {
			if (document.getElementById(STYLE_ID$1) !== null) return () => {};
			const style = document.createElement("style");
			style.id = STYLE_ID$1;
			style.textContent = css$1;
			document.head.append(style);
			return () => {
				style.remove();
			};
		}
		//#endregion
		//#region src/market/client/api.ts
		var LoomClientApiError = class extends Error {
			status;
			constructor(message, status) {
				super(message);
				this.status = status;
				this.name = "LoomClientApiError";
			}
		};
		const ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
		function record$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function string(value) {
			return typeof value === "string" ? value.trim() : "";
		}
		/** Fields without a published order keep their schema position, after every ordered field. */
		const UNORDERED_FIELD = Number.MAX_SAFE_INTEGER;
		function stringList(value) {
			return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "") : [];
		}
		/** `default_value` reaches us as a string in the published schema but may be a scalar. */
		function scalarText(value) {
			if (typeof value === "number" && Number.isFinite(value)) return String(value);
			if (typeof value === "boolean") return String(value);
			const text = string(value);
			return text === "" ? void 0 : text;
		}
		/**
		* Reads one published input field.
		*
		* The live schema carries far more than the ids the older mapping read:
		* `presentation.hint` holds the authoring hint most listings populate,
		* `presentation.widget` and `order` drive how the form is drawn, and
		* `default_value`, `accepted_mime_types` and `max_values` describe the value the
		* field accepts. Dropping them is what reduced the form to bare text boxes (the
		* `style` field of the presentation generator offers 26 options, all of them
		* encoded in its hint).
		*
		* Legacy keys stay supported because the chat tools and older snapshot rows vary.
		*/
		function field(value) {
			const item = record$1(value);
			const key = string(item.key ?? item.name ?? item.fieldKey);
			if (key === "") return void 0;
			const presentation = record$1(item.presentation);
			const enumValues = stringList(item.enum_values ?? item.enumValues);
			const acceptedMimeTypes = stringList(item.accepted_mime_types ?? item.acceptedMimeTypes);
			const description = string(item.description ?? item.desc) || string(presentation.hint ?? item.inputHint ?? item.help);
			const placeholder = string(presentation.placeholder ?? item.placeholder);
			const widget = string(presentation.widget ?? item.widget);
			const defaultValue = scalarText(item.default_value ?? item.defaultValue);
			const maxValues = typeof item.max_values === "number" && Number.isFinite(item.max_values) ? item.max_values : void 0;
			const order = typeof item.order === "number" && Number.isFinite(item.order) ? item.order : UNORDERED_FIELD;
			return {
				key,
				label: string(item.label ?? item.title ?? item.displayName) || key,
				required: item.required === true || item.isRequired === true,
				valueType: string(item.value_type ?? item.valueType ?? item.type) || "string",
				order,
				...description === "" ? {} : { description },
				...placeholder === "" ? {} : { placeholder },
				...widget === "" ? {} : { widget },
				...defaultValue === void 0 ? {} : { defaultValue },
				...enumValues.length === 0 ? {} : { enumValues },
				...acceptedMimeTypes.length === 0 ? {} : { acceptedMimeTypes },
				...maxValues === void 0 ? {} : { maxValues }
			};
		}
		function fields(value) {
			const snapshot = record$1(value).inputSchemaSnapshot;
			let schema = {};
			if (typeof snapshot === "string") try {
				schema = record$1(JSON.parse(snapshot));
			} catch {
				return [];
			}
			else schema = record$1(snapshot);
			if (!Array.isArray(schema.fields)) return [];
			return schema.fields.map(field).filter((value) => value !== void 0).sort((left, right) => left.order - right.order);
		}
		/** Maps one Host-normalized storefront entry; a worthless entry is dropped. */
		function storefrontEntry(value) {
			const item = record$1(value);
			const id = string(item.id);
			if (id === "") return void 0;
			const fixedFee = string(item.fixedFee);
			const currency = string(item.currency);
			const version = string(item.version);
			const updatedAt = string(item.updatedAt);
			const creatorNickname = string(item.creatorNickname);
			return {
				id,
				name: string(item.name) || id,
				description: string(item.description),
				available: item.available === true,
				fields: fields(item),
				...fixedFee === "" ? {} : { fixedFee },
				...currency === "" ? {} : { currency },
				...version === "" ? {} : { version },
				...updatedAt === "" ? {} : { updatedAt },
				...creatorNickname === "" ? {} : { creatorNickname }
			};
		}
		async function readJson(input, signal) {
			const response = await fetch(input, {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			});
			let payload;
			try {
				payload = record$1(await response.json());
			} catch {
				throw new LoomClientApiError("loomloom returned an invalid response", 502);
			}
			if (!response.ok) throw new LoomClientApiError(string(payload.error) || `request failed: ${response.status}`, response.status);
			return payload;
		}
		async function postJson(input, signal, body) {
			const response = await fetch(input, {
				method: "POST",
				cache: "no-store",
				...body === void 0 ? {} : {
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				},
				...signal === void 0 ? {} : { signal }
			});
			let payload;
			try {
				payload = await response.json();
			} catch {
				throw new LoomClientApiError("loomloom returned an invalid response", 502);
			}
			if (!response.ok) throw new LoomClientApiError(string(record$1(payload).error) || `request failed: ${response.status}`, response.status);
			return payload;
		}
		function items(value) {
			const payload = record$1(value);
			const data = record$1(payload.data);
			return Array.isArray(payload.items) ? payload.items : Array.isArray(data.items) ? data.items : Array.isArray(payload.listings) ? payload.listings : Array.isArray(data.listings) ? data.listings : [];
		}
		async function readCredentialStatus(signal) {
			const result = await readJson("/api/loomloom/credentials", signal);
			return {
				configured: result.configured === true,
				...typeof result.maskedToken === "string" && result.maskedToken !== "" ? { maskedToken: result.maskedToken } : {}
			};
		}
		async function readAccount(signal) {
			const result = await readJson("/api/loomloom/account", signal);
			const account = { configured: result.configured === true };
			for (const field of [
				"uid",
				"displayName",
				"email",
				"photoUrl",
				"balance"
			]) {
				const value = result[field];
				if (typeof value === "string" && value.trim() !== "") account[field] = value.trim();
			}
			if (typeof result.isCreator === "boolean") account.isCreator = result.isCreator;
			return account;
		}
		async function readBootstrap(signal) {
			const result = await readJson("/api/loomloom/bootstrap", signal);
			const credential = record$1(result.credential);
			const model = record$1(result.model);
			const loom = result.loom === "ready" || result.loom === "unavailable" ? result.loom : "unknown";
			const router = result.router === "ready" || result.router === "unavailable" ? result.router : "unknown";
			const id = string(model.id);
			return {
				credential: { configured: credential.configured === true },
				loom,
				router,
				model: {
					provider: "shengsuanyun",
					...id === "" ? {} : { id },
					ready: model.ready === true
				}
			};
		}
		async function logout(signal) {
			await postJson("/api/loomloom/credentials/logout", signal);
		}
		function optionalCount(key, value) {
			return typeof value === "number" && Number.isFinite(value) ? { [key]: value } : {};
		}
		function run(value) {
			const item = record$1(value);
			const nested = record$1(item.run ?? item.data);
			const id = string(nested.runId ?? nested.id ?? item.runId ?? item.id);
			if (id === "") throw new LoomClientApiError("loomloom returned an invalid run", 502);
			const updatedAt = string(nested.updatedAt ?? nested.updated_at ?? item.updatedAt ?? item.updated_at);
			const firstErrorMessage = string(nested.firstErrorMessage ?? item.firstErrorMessage);
			return {
				id,
				displayName: string(nested.displayName ?? nested.name ?? item.displayName ?? item.name) || id,
				status: string(nested.status ?? item.status) || "unknown",
				...updatedAt === "" ? {} : { updatedAt },
				...optionalCount("totalTasks", nested.totalTasks ?? item.totalTasks),
				...optionalCount("completedTasks", nested.completedTasks ?? item.completedTasks),
				...optionalCount("failedTasks", nested.failedTasks ?? item.failedTasks),
				...firstErrorMessage === "" ? {} : { firstErrorMessage }
			};
		}
		async function startBrowserLogin(signal) {
			const result = await postJson("/api/loomloom/login/start", signal);
			if (!/^[A-Za-z0-9_-]{32}$/.test(result.sessionId) || !result.url.startsWith("https://")) throw new LoomClientApiError("loomloom returned an invalid login session", 502);
			return result;
		}
		async function readBrowserLoginStatus(sessionId, signal) {
			if (!/^[A-Za-z0-9_-]{32}$/.test(sessionId)) throw new LoomClientApiError("invalid login session", 400);
			const url = new URL("/api/loomloom/login/status", window.location.origin);
			url.searchParams.set("sessionId", sessionId);
			const result = await readJson(url, signal);
			const state = result.state;
			const reason = result.reason;
			if (state === "pending" || state === "verifying-loom" || state === "verifying-router" || state === "model-selection-required" || state === "complete" || state === "cancelled" || state === "failed") return {
				state,
				...reason === "browser-unavailable" || reason === "authorization-cancelled" || reason === "authorization-timeout" || reason === "loom-validation-failed" || reason === "router-validation-failed" || reason === "no-chat-model" || reason === "credential-save-failed" ? { reason } : {}
			};
			throw new LoomClientApiError("loomloom returned an invalid login session", 502);
		}
		async function cancelBrowserLogin(sessionId, signal) {
			if (!/^[A-Za-z0-9_-]{32}$/.test(sessionId)) throw new LoomClientApiError("invalid login session", 400);
			const url = new URL("/api/loomloom/login/cancel", window.location.origin);
			url.searchParams.set("sessionId", sessionId);
			await postJson(url, signal);
		}
		/**
		* Reads this build's configured storefront.
		*
		* Every value here is anonymous public Market data, so this runs before any
		* credential exists — browsing a storefront never requires signing in.
		* @param refresh - ask the Host to bypass its cached snapshot.
		*/
		async function readStorefront(refresh = false, signal) {
			const url = new URL("/api/loomloom/storefront", window.location.origin);
			if (refresh) url.searchParams.set("refresh", "1");
			const payload = record$1(await readJson(url, signal));
			const error = string(payload.error);
			const rawSource = payload.source;
			const source = rawSource === "creator" || rawSource === "public" || rawSource === "pinned" || rawSource === "creator-key-missing" || rawSource === "none" ? rawSource : "none";
			return {
				configured: payload.configured === true,
				source,
				entries: (Array.isArray(payload.entries) ? payload.entries : []).map(storefrontEntry).filter((value) => value !== void 0),
				unavailable: Array.isArray(payload.unavailable) ? payload.unavailable.filter((value) => typeof value === "string") : [],
				fetchedAt: string(payload.fetchedAt),
				stale: payload.stale === true,
				...error === "" ? {} : { error }
			};
		}
		/**
		* Uploads one file input.
		*
		* `value_type: asset_ref` fields are satisfied by the returned `inputAssetId`, so
		* the bytes only ever pass through the Host; the form keeps the id, not the file.
		*/
		async function uploadInputAsset(filename, contentType, contentBase64, signal) {
			const payload = record$1(await postJson("/api/loomloom/inputAssets", signal, {
				filename,
				contentType,
				content: contentBase64
			}));
			const inputAssetId = string(payload.inputAssetId);
			if (inputAssetId === "") throw new LoomClientApiError("loomloom returned an invalid input asset", 502);
			const sizeBytes = payload.sizeBytes;
			return {
				inputAssetId,
				filename: string(payload.filename) || filename,
				mimeType: string(payload.mimeType) || contentType,
				sizeBytes: typeof sizeBytes === "number" && Number.isFinite(sizeBytes) ? sizeBytes : 0
			};
		}
		async function readRuns(signal) {
			return items(await readJson("/api/loomloom/runs", signal)).map(run).slice(0, 20);
		}
		async function readRun(runId, signal) {
			if (!ID_PATTERN.test(runId)) throw new LoomClientApiError("invalid run id", 400);
			const url = new URL("/api/loomloom/runs/status", window.location.origin);
			url.searchParams.set("runId", runId);
			return run(await readJson(url, signal));
		}
		//#endregion
		//#region src/market/client/connect-stage.ts
		/**
		* Decides the stage from the Host's readiness facts.
		*
		* The Host verifies the chat model against the ShengSuanYun route and names an
		* `id` only when the agent default model sits on that route. A model selected on
		* any other route therefore arrives as `id === undefined`, and it must NOT hold a
		* first-run surface open: the credential is what onboarding owns, and a blocking
		* dialog with no way out is worse than an unverified model the user can still fix
		* in Settings.
		* @param value - the Host's non-secret readiness facts.
		* @returns the stage to render.
		*/
		function connectStage(value) {
			if (!value.credential.configured) return "unconfigured";
			if (value.loom !== "ready" || value.router !== "ready") return "unconfigured";
			if (value.model.ready || value.model.id === void 0) return "connected";
			return "model-selection";
		}
		//#endregion
		//#region src/market/client/LoomloomConnectFlow.tsx
		const pollIntervalMs = 500;
		function delay(signal) {
			return new Promise((resolve, reject) => {
				const timer = window.setTimeout(resolve, pollIntervalMs);
				const abort = () => {
					window.clearTimeout(timer);
					reject(new DOMException("The login poll was cancelled", "AbortError"));
				};
				signal.addEventListener("abort", abort, { once: true });
			});
		}
		function isAbort(cause) {
			return cause instanceof DOMException && cause.name === "AbortError";
		}
		function reasonMessage(reason, t) {
			switch (reason) {
				case "authorization-cancelled": return t("authorizationCancelled");
				case "authorization-timeout": return t("authorizationTimedOut");
				case "loom-validation-failed": return t("loomValidationFailed");
				case "router-validation-failed": return t("routerValidationFailed");
				case "no-chat-model": return t("noChatModel");
				case "credential-save-failed": return t("credentialSaveFailed");
				case "browser-unavailable": return t("browserUnavailable");
				default: return t("signInFailed");
			}
		}
		function errorMessage(cause, fallback) {
			return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
		}
		function LoomloomOnboardingSurface({ title, children }) {
			const dialog = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const node = dialog.current;
				if (node === null) return;
				node.showModal();
				return () => {
					if (node.open) node.close();
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dialog", {
				ref: dialog,
				className: "loomloomOnboarding",
				"aria-labelledby": "loomloom-onboarding-title",
				onCancel: (event) => event.preventDefault(),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "loomloomOnboardingContent",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "loomloom-onboarding-title",
						tabIndex: -1,
						children: title
					}), children]
				})
			});
		}
		/**
		* A shared first-run connection flow for Settings and the public onboarding
		* slot. It receives only opaque session ids and non-secret status facts.
		*/
		function LoomloomConnectFlow({ t, refreshKey, onConnected, onAlreadyConfigured, onOpenModels, onboarding = false, onLater, onCreateFirstChat }) {
			const [stage, setStage] = (0, react.useState)("loading");
			const [loginState, setLoginState] = (0, react.useState)("pending");
			const [error, setError] = (0, react.useState)();
			const [browserWasBlocked, setBrowserWasBlocked] = (0, react.useState)(false);
			const sessionRef = (0, react.useRef)();
			const authorizationUrlRef = (0, react.useRef)();
			const pollController = (0, react.useRef)();
			const cancelOnUnmount = (0, react.useRef)(true);
			const startedHere = (0, react.useRef)(false);
			const signInButton = (0, react.useRef)(null);
			const errorId = (0, react.useId)();
			const stopPolling = (0, react.useCallback)((cancelRemote) => {
				pollController.current?.abort();
				pollController.current = void 0;
				const sessionId = sessionRef.current;
				sessionRef.current = void 0;
				authorizationUrlRef.current = void 0;
				if (cancelRemote && cancelOnUnmount.current && sessionId !== void 0) cancelBrowserLogin(sessionId).catch(() => void 0);
			}, []);
			const refresh = (0, react.useCallback)(async () => {
				try {
					setStage("loading");
					setError(void 0);
					const value = await readBootstrap();
					const next = connectStage(value);
					if (next === "connected") {
						setStage("connected");
						if (!startedHere.current) onAlreadyConfigured?.();
					} else if (next === "model-selection") setStage("model-selection");
					else {
						setStage("unconfigured");
						if (value.credential.configured) setError(t("connectionStatusFailed"));
					}
				} catch (cause) {
					setStage("unconfigured");
					setError(errorMessage(cause, t("connectionStatusFailed")));
				}
			}, [onAlreadyConfigured, t]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh, refreshKey]);
			(0, react.useEffect)(() => () => {
				stopPolling(true);
			}, [stopPolling]);
			const poll = (0, react.useCallback)(async (sessionId, controller) => {
				try {
					for (;;) {
						await delay(controller.signal);
						const status = await readBrowserLoginStatus(sessionId, controller.signal);
						setLoginState(status.state);
						if (status.state === "pending" || status.state === "verifying-loom" || status.state === "verifying-router") continue;
						pollController.current = void 0;
						if (status.state === "complete") {
							sessionRef.current = void 0;
							authorizationUrlRef.current = void 0;
							setStage("connected");
							onConnected?.();
							return;
						}
						if (status.state === "model-selection-required") {
							cancelOnUnmount.current = false;
							setStage("model-selection");
							return;
						}
						sessionRef.current = void 0;
						authorizationUrlRef.current = void 0;
						setStage("unconfigured");
						setError(reasonMessage(status.reason, t));
						window.setTimeout(() => signInButton.current?.focus(), 0);
						return;
					}
				} catch (cause) {
					if (isAbort(cause)) return;
					setStage("unconfigured");
					setError(errorMessage(cause, t("signInFailed")));
				}
			}, [
				onConnected,
				refresh,
				t
			]);
			const signIn = (0, react.useCallback)(async () => {
				stopPolling(true);
				startedHere.current = true;
				cancelOnUnmount.current = true;
				setError(void 0);
				setBrowserWasBlocked(false);
				setLoginState("pending");
				try {
					const login = await startBrowserLogin();
					sessionRef.current = login.sessionId;
					authorizationUrlRef.current = login.url;
					const popup = window.open(login.url, "_blank", "noopener,noreferrer");
					setBrowserWasBlocked(popup === null);
					const controller = new AbortController();
					pollController.current = controller;
					setStage("authorizing");
					poll(login.sessionId, controller);
				} catch (cause) {
					setStage("unconfigured");
					setError(errorMessage(cause, t("signInFailed")));
					window.setTimeout(() => signInButton.current?.focus(), 0);
				}
			}, [
				poll,
				stopPolling,
				t
			]);
			const cancel = (0, react.useCallback)(async () => {
				const sessionId = sessionRef.current;
				pollController.current?.abort();
				pollController.current = void 0;
				sessionRef.current = void 0;
				authorizationUrlRef.current = void 0;
				if (sessionId !== void 0) try {
					await cancelBrowserLogin(sessionId);
				} catch (cause) {
					setError(errorMessage(cause, t("cancelFailed")));
				}
				cancelOnUnmount.current = true;
				setStage("unconfigured");
				window.setTimeout(() => signInButton.current?.focus(), 0);
			}, [t]);
			const copyAuthorizationLink = (0, react.useCallback)(async () => {
				const url = authorizationUrlRef.current;
				if (url === void 0 || !navigator.clipboard?.writeText) {
					setError(t("copyLinkFailed"));
					return;
				}
				try {
					await navigator.clipboard.writeText(url);
					setError(void 0);
				} catch {
					setError(t("copyLinkFailed"));
				}
			}, [t]);
			if (onboarding && stage === "connected" && !startedHere.current) return null;
			const body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				stage === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "loomloomFlowDescription",
					role: "status",
					children: t("loading")
				}),
				stage === "unconfigured" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomFlowDescription",
						children: t("connectDescription")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "loomloomFlowDetails",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("connectionDetails") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("connectionDetailsBody") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomFlowPrivacy",
						children: t("connectionPrivacy")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "loomloomFlowActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							ref: signInButton,
							className: "loomloomButton loomloomButtonPrimary",
							type: "button",
							onClick: () => void signIn(),
							"aria-describedby": error === void 0 ? void 0 : errorId,
							children: t("signIn")
						}), onboarding && onLater !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: onLater,
							children: t("connectLater")
						})]
					})
				] }),
				stage === "authorizing" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomFlowDescription",
						role: "status",
						children: loginState === "verifying-loom" ? t("verifyingLoom") : loginState === "verifying-router" ? t("verifyingRouter") : t("signInWaiting")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ol", {
						className: "loomloomFlowSteps",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								"data-current": loginState === "pending",
								children: t("waitingBrowser")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								"data-current": loginState === "verifying-loom",
								children: t("verifyingLoom")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								"data-current": loginState === "verifying-router",
								children: t("verifyingRouter")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								"data-current": false,
								children: t("savingConnection")
							})
						]
					}),
					browserWasBlocked && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "loomloomInlineWarning",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, { size: 14 }), t("browserUnavailable")] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: () => void copyAuthorizationLink(),
							children: t("copyAuthorizationLink")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomFlowActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: () => void cancel(),
							children: t("cancelSignIn")
						})
					})
				] }),
				stage === "model-selection" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "loomloomFlowDescription",
					children: t("modelSelectionRequired")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "loomloomFlowActions",
					children: [
						onOpenModels !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton loomloomButtonPrimary",
							type: "button",
							onClick: onOpenModels,
							children: t("openModels")
						}),
						onLater !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: onLater,
							children: t("modelSelectionLater")
						}),
						sessionRef.current !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: () => void cancel(),
							children: t("cancelSignIn")
						})
					]
				})] }),
				stage === "connected" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "loomloomConnectionChecks",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 12 }), t("loomReady")] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 12 }), t("chatModelReady")] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomFlowDescription",
						children: t("connectedHint")
					}),
					onboarding && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomFlowActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton loomloomButtonPrimary",
							type: "button",
							onClick: onCreateFirstChat,
							children: t("createFirstChat")
						})
					})
				] }),
				error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					id: errorId,
					className: "loomloomError",
					role: "alert",
					children: error
				})
			] });
			if (onboarding) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoomloomOnboardingSurface, {
				title: t("onboardingTitle"),
				children: body
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: "loomloomConnectFlow",
				"aria-label": t("connectionTitle"),
				children: body
			});
		}
		/** First-run entry; it leaves all session creation to DSH's native UI. */
		function LoomloomOnboarding({ complete, openSection, t, onCreateFirstChat }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoomloomConnectFlow, {
				t,
				onboarding: true,
				onAlreadyConfigured: complete,
				onOpenModels: () => openSection("models"),
				onLater: complete,
				onCreateFirstChat
			});
		}
		//#endregion
		//#region src/market/client/LoomloomSettingsTab.tsx
		function failureMessage(cause, fallback) {
			return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
		}
		function LoomloomSettingsTab({ t }) {
			const [credentials, setCredentials] = (0, react.useState)({ configured: false });
			const [skillbots, setSkillbots] = (0, react.useState)([]);
			const [runs, setRuns] = (0, react.useState)([]);
			const [selected, setSelected] = (0, react.useState)();
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)();
			const [storefrontNotice, setStorefrontNotice] = (0, react.useState)();
			const [runLoading, setRunLoading] = (0, react.useState)(false);
			const [signingOut, setSigningOut] = (0, react.useState)(false);
			const [connectRefreshKey, setConnectRefreshKey] = (0, react.useState)(0);
			const load = (0, react.useCallback)(async (signal) => {
				setLoading(true);
				setError(void 0);
				setStorefrontNotice(void 0);
				try {
					const status = await readCredentialStatus(signal);
					if (signal?.aborted) return;
					setCredentials(status);
					if (!status.configured) {
						setSkillbots([]);
						setRuns([]);
						setSelected(void 0);
						return;
					}
					const [storefront, recentRuns] = await Promise.all([readStorefront(false, signal), readRuns(signal)]);
					if (signal?.aborted) return;
					setSkillbots(storefront.entries);
					setRuns(recentRuns);
					setStorefrontNotice(storefront.error !== void 0 ? t("staleStorefront") : storefront.configured ? void 0 : storefront.source === "creator-key-missing" ? t("storefrontCreatorKeyMissing") : t("storefrontUnconfigured"));
				} catch (cause) {
					if (signal?.aborted) return;
					setError(failureMessage(cause, t("error")));
				} finally {
					if (!signal?.aborted) setLoading(false);
				}
			}, [t]);
			const refreshRuns = (0, react.useCallback)(async () => {
				setRunLoading(true);
				try {
					setRuns(await readRuns());
				} catch (cause) {
					setError(failureMessage(cause, t("error")));
				} finally {
					setRunLoading(false);
				}
			}, [t]);
			const refreshRun = (0, react.useCallback)(async (runId) => {
				try {
					const current = await readRun(runId);
					setRuns((previous) => previous.map((item) => item.id === runId ? current : item));
				} catch (cause) {
					setError(failureMessage(cause, t("error")));
				}
			}, [t]);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				load(controller.signal);
				return () => {
					controller.abort();
				};
			}, [load]);
			const select = (0, react.useCallback)((entry) => {
				setError(void 0);
				setSelected(entry);
			}, []);
			const signOut = (0, react.useCallback)(async () => {
				setSigningOut(true);
				setError(void 0);
				try {
					await logout();
					setCredentials({ configured: false });
					setSkillbots([]);
					setRuns([]);
					setSelected(void 0);
					setConnectRefreshKey((value) => value + 1);
				} catch (cause) {
					setError(failureMessage(cause, t("error")));
				} finally {
					setSigningOut(false);
				}
			}, [t]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "loomloomRoot",
				"aria-label": t("tab"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "loomloomHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("subtitle") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: () => {
								setConnectRefreshKey((value) => value + 1);
								load();
							},
							disabled: loading,
							children: loading ? t("loading") : t("refresh")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoomloomConnectFlow, {
						t,
						refreshKey: connectRefreshKey,
						onConnected: () => {
							load();
						}
					}),
					credentials.configured && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "loomloomNote loomloomAccountActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("credentialHint") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: () => void signOut(),
							disabled: signingOut,
							children: signingOut ? t("signingOut") : t("signOut")
						})]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomError",
						role: "alert",
						children: error
					}),
					storefrontNotice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomNote",
						role: "status",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: storefrontNotice })
					}),
					credentials.configured && !loading && error === void 0 && storefrontNotice === void 0 && skillbots.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomEmpty",
						children: t("empty")
					}),
					credentials.configured && skillbots.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomGrid",
						"aria-label": t("title"),
						children: skillbots.map((skillbot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							className: "loomloomCard",
							type: "button",
							"aria-pressed": selected?.id === skillbot.id,
							onClick: () => {
								select(skillbot);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "loomloomCardTop",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: skillbot.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "loomloomBadge",
										"data-available": skillbot.available,
										children: skillbot.available ? t("available") : t("unavailable")
									})]
								}),
								skillbot.description !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: skillbot.description }),
								skillbot.fixedFee !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "loomloomMeta",
									children: [
										t("fee"),
										": ",
										skillbot.fixedFee
									]
								})
							]
						}, skillbot.id))
					}),
					selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "loomloomDetail",
						"aria-label": selected.name,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "loomloomDetailHead",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("schema") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: selected.name })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "loomloomFieldHint",
								children: t("inputHint")
							}),
							selected.fields.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "loomloomEmpty",
								children: t("noSchema")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "loomloomFields",
								children: selected.fields.map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "loomloomField",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "loomloomFieldHead",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: field.label }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: field.key }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "loomloomFieldTag",
													children: [
														field.required ? t("required") : t("optional"),
														" · ",
														field.valueType
													]
												})
											]
										}),
										field.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: field.description }),
										field.enumValues !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: field.enumValues.join(" · ") })
									]
								}, field.key))
							})
						]
					}),
					credentials.configured && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "loomloomDetail",
						"aria-label": t("runs"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "loomloomDetailHead",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("runs") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "loomloomButton",
								type: "button",
								onClick: () => void refreshRuns(),
								disabled: runLoading,
								children: runLoading ? t("loading") : t("refresh")
							})]
						}), runs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "loomloomEmpty",
							children: t("noRuns")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "loomloomRuns",
							children: runs.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "loomloomRun",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.displayName }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.id })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "loomloomRunStatus",
										children: item.status
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "loomloomButton",
										type: "button",
										onClick: () => void refreshRun(item.id),
										children: t("runRefresh")
									})
								]
							}, item.id))
						})]
					}),
					credentials.configured && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: "loomloomNote",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("chatExecution") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("chatExecutionDetail") })]
					})
				]
			});
		}
		//#endregion
		//#region src/market/client/LoomloomIdentityAction.tsx
		function initials(account) {
			return (account.displayName ?? account.email ?? "?").trim().slice(0, 1).toUpperCase();
		}
		function credentialFallback(maskedToken) {
			return maskedToken === void 0 ? "胜算云账户" : `API Key ${maskedToken}`;
		}
		function LoomloomIdentityAction({ wide, t }) {
			const [configured, setConfigured] = (0, react.useState)(false);
			const [maskedToken, setMaskedToken] = (0, react.useState)();
			const [account, setAccount] = (0, react.useState)();
			const [open, setOpen] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)();
			const refresh = async () => {
				setLoading(true);
				try {
					const status = await readCredentialStatus();
					setConfigured(status.configured);
					setMaskedToken(status.maskedToken);
					if (status.configured) try {
						setAccount(await readAccount());
						setError(void 0);
					} catch {
						setAccount(void 0);
						setError(t("accountUnavailable"));
					}
					else {
						setAccount(void 0);
						setError(void 0);
					}
				} catch (cause) {
					setError(t("connectionStatusFailed"));
				} finally {
					setLoading(false);
				}
			};
			(0, react.useEffect)(() => {
				refresh();
			}, []);
			const label = configured ? account?.displayName ?? account?.email ?? credentialFallback(maskedToken) : t("signIn");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				className: "loomloomIdentityAction",
				type: "button",
				"aria-label": label,
				onClick: () => {
					setOpen(true);
					refresh();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "loomloomIdentityAvatar",
					"aria-hidden": "true",
					children: configured && account?.photoUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						src: account.photoUrl,
						alt: ""
					}) : configured ? initials(account ?? { configured: true }) : "云"
				}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "loomloomIdentityCopy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: loading ? t("loading") : label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: configured ? t("accountConnected") : t("signInPrompt") })]
				})]
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: () => {
					setOpen(false);
				},
				title: configured ? label : t("signIn"),
				closeLabel: t("close"),
				className: "loomloomDialogNarrow",
				contentClassName: "loomloomDialogScroll",
				children: !configured ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoomloomConnectFlow, {
					t,
					onConnected: () => {
						setOpen(false);
						refresh();
					},
					onLater: () => setOpen(false)
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "loomloomIdentityDetails",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "loomloomIdentityProfile",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "loomloomIdentityAvatar loomloomIdentityAvatarLarge",
								"aria-hidden": "true",
								children: account?.photoUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									src: account.photoUrl,
									alt: ""
								}) : initials(account ?? { configured: true })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: account?.displayName ?? account?.email ?? credentialFallback(maskedToken) }), account?.email && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: account.email })] })]
						}),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "loomloomAlert",
							"data-tone": "danger",
							role: "status",
							children: error
						}),
						account && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: "loomloomIdentityFacts",
							children: [
								account?.uid && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("accountId") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: account.uid })] }),
								account?.balance && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("balance") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: account.balance })] }),
								account?.isCreator !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("accountRole") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: account.isCreator ? t("creator") : t("user") })] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "loomloomButton",
							type: "button",
							onClick: () => {
								logout().then(() => {
									setConfigured(false);
									setAccount(void 0);
									setOpen(false);
								}).catch((cause) => {
									setError(cause instanceof Error ? cause.message : t("error"));
								});
							},
							children: t("signOut")
						})
					]
				})
			})] });
		}
		//#endregion
		//#region src/market/client/field-input.ts
		function fieldControl(field) {
			if (field.valueType === "asset_ref") return "file";
			if (field.enumValues !== void 0 || field.valueType === "enum" || field.widget === "select") return "select";
			if (field.valueType === "boolean" || field.valueType === "bool") return "checkbox";
			if (field.widget === "textarea") return "textarea";
			if (field.valueType === "integer" || field.valueType === "number" || field.valueType === "float") return "number";
			return "text";
		}
		function scalar(value, integer) {
			if (!integer) return value;
			const parsed = Number.parseInt(value, 10);
			return Number.isFinite(parsed) ? parsed : value;
		}
		/** Values a form starts with, taking every published `default_value` into account. */
		function initialValues(fields) {
			const values = {};
			for (const field of fields) {
				const fallback = field.defaultValue;
				if (fallback === void 0 || fallback === "") continue;
				if (field.valueType === "boolean" || field.valueType === "bool") values[field.key] = fallback === "true";
				else values[field.key] = scalar(fallback, field.valueType === "integer");
			}
			return values;
		}
		function isBlank(value) {
			if (value === void 0 || value === null) return true;
			if (typeof value === "string") return value.trim() === "";
			return false;
		}
		/**
		* Required fields with no usable value.
		*
		* The Market rejects a run with missing required input, so the form blocks first
		* and names the offending fields instead of spending a quote on a doomed request.
		*/
		function missingRequired(fields, values) {
			return fields.filter((field) => field.required && isBlank(values[field.key]));
		}
		/**
		* The single input row to submit.
		*
		* Blank optional fields are omitted rather than sent as empty strings, and
		* integers are sent as numbers so the server does not have to interpret text. A
		* file field carries the uploaded `inputAssetId` its upload returned.
		*/
		function payloadRow(fields, values) {
			const row = {};
			for (const field of fields) {
				const value = values[field.key];
				if (isBlank(value)) continue;
				if (field.valueType === "integer") {
					const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
					if (Number.isFinite(parsed)) {
						row[field.key] = parsed;
						continue;
					}
				}
				row[field.key] = value;
			}
			return row;
		}
		//#endregion
		//#region src/market/client/market-format.ts
		/**
		* Pure formatting and filtering for the market surface.
		*
		* The market cards are a thin renderer over these functions, which keeps the
		* search, fee and monogram rules testable without a DOM.
		*/
		/** Case-insensitive substring test over the fields a card shows. */
		function matches(entry, needle) {
			return [
				entry.name,
				entry.description,
				entry.creatorNickname ?? ""
			].some((value) => value.toLowerCase().includes(needle));
		}
		/**
		* Entries matching a free-text query.
		* @param entries - the storefront's entries, in published order.
		* @param query - what the user typed; blank returns every entry.
		* @returns the matching entries, order preserved.
		*/
		function filterEntries(entries, query) {
			const needle = query.trim().toLowerCase();
			if (needle === "") return entries;
			return entries.filter((entry) => matches(entry, needle));
		}
		/**
		* Fixed fee with its currency, as one card- and dialog-ready string.
		* @param entry - the storefront entry.
		* @param freeLabel - the localized label used when the listing charges nothing.
		* @returns e.g. `0.0100000 CNY`, or the free label.
		*/
		function feeText(entry, freeLabel) {
			const amount = entry.fixedFee ?? freeLabel;
			return entry.currency === void 0 ? amount : `${amount} ${entry.currency}`;
		}
		/** Publication date in the viewer's locale, or undefined when absent or unparsable. */
		function updatedText(iso) {
			if (iso === void 0 || iso.trim() === "") return void 0;
			const value = new Date(iso);
			return Number.isNaN(value.getTime()) ? void 0 : value.toLocaleDateString();
		}
		/**
		* First character of a name, for the card's avatar tile.
		* @param name - creator nickname, falling back to the SkillBot name.
		* @returns one upper-cased character; `?` for an empty name.
		*/
		function monogram(name) {
			const first = name === void 0 ? void 0 : [...name.trim()][0];
			return first === void 0 ? "?" : first.toUpperCase();
		}
		//#endregion
		//#region src/market/client/market-loader.ts
		const defaultMarketSource = { readStorefront };
		/**
		* Resolves the storefront, turning a transport failure into a renderable value.
		*
		* The Host already answers 200 with `stale` and `error` when it can fall back to
		* a cached snapshot, so a rejection here means there is nothing at all to show.
		*/
		async function loadMarket(source, refresh = false, signal) {
			try {
				return {
					ok: true,
					storefront: await source.readStorefront(refresh, signal)
				};
			} catch (cause) {
				return {
					ok: false,
					message: cause instanceof Error && cause.message.trim() !== "" ? cause.message : "storefront unavailable"
				};
			}
		}
		//#endregion
		//#region src/market/client/market-navigation.ts
		let active = false;
		const listeners = /* @__PURE__ */ new Set();
		function setLoomloomMarketActive(value) {
			if (active === value) return;
			active = value;
			for (const listener of listeners) listener();
		}
		function useLoomloomMarketActive() {
			return (0, react.useSyncExternalStore)((listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, () => active, () => false);
		}
		/**
		* Whether a click should hand the main surface back to the conversation.
		*
		* Only picking a **session row** does: the market occupies the main surface, so
		* choosing a conversation has to reveal it. Every other click — the market's own
		* rows, its preview control, its refresh button, the page background — must leave
		* the surface alone.
		*
		* This is deliberately a predicate rather than an inline condition. The previous
		* inline test read `treeItem?.closest('[role="tree"]') === null`, which yields
		* `undefined` (not `null`) whenever the click is *not* inside a session row, so
		* the guard never fired and **any** click anywhere deactivated the market — the
		* page could not be used at all.
		*
		* @param target - the click's target element, or null when it was not an element.
		* @returns true only for a click inside the sidebar's session tree.
		*/
		function leavesMarketOnClick(target) {
			if (target === null) return false;
			const treeItem = target.closest("[role=\"treeitem\"]");
			if (treeItem === null) return false;
			return treeItem.closest("[role=\"tree\"]") !== null;
		}
		/**
		* Leave the market surface when the user picks a session, and only then.
		* @returns disposer removing the listener.
		*/
		function installLoomloomSessionNavigationBridge() {
			const onClick = (event) => {
				if (!active) return;
				if (!leavesMarketOnClick(event.target instanceof Element ? event.target : null)) return;
				setLoomloomMarketActive(false);
			};
			document.addEventListener("click", onClick, true);
			return () => {
				document.removeEventListener("click", onClick, true);
			};
		}
		//#endregion
		//#region src/market/client/skillbot-prompt.ts
		const DEFAULT_ATTEMPTS = 5;
		const DEFAULT_DELAY_MS = 50;
		async function bindable(sessions, id, attempts, delayMs, sleep) {
			for (let attempt = 0; attempt < attempts; attempt += 1) {
				const session = sessions.binding(id)?.session;
				if (session !== void 0) return session;
				if (attempt < attempts - 1) await sleep(delayMs);
			}
			throw new Error(`loomloom: session "${id}" exposed no addressable conversation surface`);
		}
		/**
		* Resolves the session to send into.
		*
		* The default is a **new** session, and that default is the point: a SkillBot call
		* is a self-contained job, not a remark in whatever conversation the user happened
		* to be reading. Appending it to the current session would bury the invocation in
		* an unrelated thread, drag that thread's context into the run, and leave the
		* answer mixed with everything else. A fresh session also gives the run its own
		* transcript to report into, and the market surface keeps working from the
		* no-session welcome state, which is where a first call tends to happen.
		*
		* `'current-session'` is kept as an explicit opt-in for callers that genuinely
		* want to continue a thread.
		*/
		async function resolveSendTarget(sessions, options = {}) {
			const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
			const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
			const sleep = options.sleep ?? (async (ms) => {
				await new Promise((resolve) => setTimeout(resolve, ms));
			});
			const snapshot = sessions.list.getSnapshot();
			const current = snapshot.current;
			const reuse = options.target === "current-session" && current !== void 0 && current !== "";
			let id = current ?? "";
			if (!reuse) {
				const workspaceId = current === void 0 ? void 0 : options.workspaceOf?.(current);
				if (workspaceId !== void 0) id = await sessions.create({ workspaceId });
				else {
					const cwd = current === void 0 ? void 0 : snapshot.byId?.[current]?.cwd;
					id = await sessions.create(cwd === void 0 ? {} : { cwd });
				}
			}
			if (!reuse) sessions.open(id);
			const session = await bindable(sessions, id, attempts, delayMs, sleep);
			return {
				id,
				async send(text) {
					if (!(await session.prompt([{
						type: "text",
						text
					}], "queue")).ok) throw new Error("the conversation rejected the prompt");
				}
			};
		}
		function invocationGate(credential) {
			if (credential === void 0) return "blocked";
			return credential.configured ? "proceed" : "authorize";
		}
		/**
		* Composes the message the agent receives.
		*
		* The input block is either the user's filled values or an explicit sentence saying
		* nothing was filled, so the agent never has to guess whether an empty form means
		* "use the defaults" or "ask me" — it is told which.
		*/
		function skillbotPrompt(input) {
			const values = input.values;
			const block = values !== void 0 && Object.keys(values).length > 0 ? [
				"```json",
				JSON.stringify(values, null, 2),
				"```"
			].join("\n") : input.noInput;
			return input.template.replaceAll("{name}", input.name).replaceAll("{listingId}", input.listingId).replaceAll("{input}", block);
		}
		//#endregion
		//#region src/market/client/LoomloomMarketPage.tsx
		function message(cause, fallback) {
			return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
		}
		/** Reads a chosen file as the base64 the upload route accepts. */
		function fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () => reject(/* @__PURE__ */ new Error("the file could not be read"));
				reader.onload = () => {
					const result = reader.result;
					if (typeof result !== "string") {
						reject(/* @__PURE__ */ new Error("the file could not be read"));
						return;
					}
					const comma = result.indexOf(",");
					if (comma === -1) {
						reject(/* @__PURE__ */ new Error("the file could not be read"));
						return;
					}
					resolve(result.slice(comma + 1));
				};
				reader.readAsDataURL(file);
			});
		}
		/** Card count drawn while the storefront is still loading. */
		const SKELETON_CARDS = [
			0,
			1,
			2
		];
		/** Nested controls keep their own behavior; the card body starts the chat handoff. */
		function isNestedControl(target) {
			return target instanceof Element && target.closest("button,a,input,textarea,select,label") !== null;
		}
		/**
		* The cloud SkillBot market.
		*
		* It presents one creator's storefront as a card grid and hands a chosen
		* SkillBot to the conversation: this surface never quotes, executes or bills
		* anything itself. A click becomes one user message and the agent drives the
		* Loomloom tools from there, which keeps a single path to a paid run and a
		* single place its result is reported.
		*/
		function LoomloomMarketPage({ t, sessions, workspaceOf }) {
			const [state, setState] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(true);
			const [query, setQuery] = (0, react.useState)("");
			const [preview, setPreview] = (0, react.useState)();
			const [values, setValues] = (0, react.useState)({});
			const [assetNames, setAssetNames] = (0, react.useState)({});
			const [uploadingKey, setUploadingKey] = (0, react.useState)();
			const [formError, setFormError] = (0, react.useState)();
			const [starting, setStarting] = (0, react.useState)(false);
			const [authorizing, setAuthorizing] = (0, react.useState)(false);
			const deferred = (0, react.useRef)(void 0);
			const inFlight = (0, react.useRef)(false);
			const loadController = (0, react.useRef)();
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			const load = (0, react.useCallback)(async (refresh = false) => {
				loadController.current?.abort();
				const controller = new AbortController();
				loadController.current = controller;
				setBusy(true);
				const result = await loadMarket(defaultMarketSource, refresh, controller.signal);
				if (controller.signal.aborted || !alive.current) return;
				setState(result);
				setBusy(false);
			}, []);
			(0, react.useEffect)(() => {
				load();
				return () => {
					loadController.current?.abort();
				};
			}, [load]);
			/** The one place an invocation leaves this surface. */
			const send = (0, react.useCallback)(async (entry, submitted) => {
				await (await resolveSendTarget(sessions, { workspaceOf })).send(skillbotPrompt({
					template: t("promptInvocation"),
					noInput: t("promptNoInput"),
					name: entry.name,
					listingId: entry.id,
					...submitted === void 0 ? {} : { values: submitted }
				}));
				if (!alive.current) return;
				setPreview(void 0);
				setAuthorizing(false);
				setValues({});
				setAssetNames({});
				setFormError(void 0);
				setLoomloomMarketActive(false);
			}, [
				sessions,
				t,
				workspaceOf
			]);
			const invoke = (0, react.useCallback)(async (entry, submitted) => {
				if (inFlight.current) return;
				inFlight.current = true;
				setStarting(true);
				setFormError(void 0);
				try {
					const gate = invocationGate(await readCredentialStatus().catch(() => void 0));
					if (gate === "blocked") {
						setFormError(t("credentialUnavailable"));
						return;
					}
					if (gate === "authorize") {
						deferred.current = {
							entry,
							...submitted === void 0 ? {} : { values: submitted }
						};
						setAuthorizing(true);
						return;
					}
					await send(entry, submitted);
				} catch (cause) {
					if (alive.current) setFormError(message(cause, t("sendFailed")));
				} finally {
					inFlight.current = false;
					if (alive.current) setStarting(false);
				}
			}, [send, t]);
			const onConnected = (0, react.useCallback)(() => {
				const call = deferred.current;
				deferred.current = void 0;
				if (call === void 0) {
					setAuthorizing(false);
					return;
				}
				(async () => {
					try {
						await send(call.entry, call.values);
					} catch (cause) {
						if (!alive.current) return;
						setAuthorizing(false);
						setFormError(message(cause, t("sendFailed")));
					}
				})();
			}, [send, t]);
			const onDeclined = (0, react.useCallback)(() => {
				deferred.current = void 0;
				setAuthorizing(false);
			}, []);
			const openPreview = (entry) => {
				setPreview(entry);
				setValues(initialValues(entry.fields));
				setAssetNames({});
				setFormError(void 0);
			};
			const closePreview = () => {
				setPreview(void 0);
				setFormError(void 0);
			};
			const updateField = (field, value) => {
				setValues((previous) => ({
					...previous,
					[field.key]: value
				}));
			};
			const clearUpload = (field) => {
				setAssetNames((previous) => {
					const next = { ...previous };
					delete next[field.key];
					return next;
				});
				updateField(field, "");
			};
			const upload = async (field, file) => {
				setUploadingKey(field.key);
				setFormError(void 0);
				try {
					const asset = await uploadInputAsset(file.name, file.type || "application/octet-stream", await fileToBase64(file));
					setAssetNames((previous) => ({
						...previous,
						[field.key]: asset.filename
					}));
					updateField(field, asset.inputAssetId);
				} catch (cause) {
					setFormError(message(cause, t("uploadFailed")));
				} finally {
					if (alive.current) setUploadingKey(void 0);
				}
			};
			const submitPreview = () => {
				if (preview === void 0) return;
				if (missingRequired(preview.fields, values).length > 0) {
					setFormError(t("requiredMissing"));
					return;
				}
				invoke(preview, payloadRow(preview.fields, values));
			};
			const storefront = state?.ok === true ? state.storefront : void 0;
			const entries = storefront?.entries ?? [];
			const visible = filterEntries(entries, query);
			const fieldInput = (field) => {
				const control = fieldControl(field);
				const value = values[field.key];
				if (control === "file") {
					const chosen = assetNames[field.key];
					const uploading = uploadingKey === field.key;
					if (chosen !== void 0 && !uploading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomDropzone",
						"data-filled": true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "loomloomDropzoneFilled",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "loomloomFileChip",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 12 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: chosen })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "loomloomButton",
								type: "button",
								"data-size": "sm",
								onClick: () => {
									clearUpload(field);
								},
								children: t("clearFile")
							})]
						})
					});
					const accepted = field.acceptedMimeTypes ?? [];
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "loomloomDropzone",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPaperclipOutline16, { size: 20 }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: uploading ? t("uploading") : t("dropzoneTitle") }),
							accepted.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("dropzoneHint", { types: accepted.join(" / ") }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "loomloomDropzoneInput",
								type: "file",
								accept: accepted.join(","),
								disabled: uploading,
								onChange: (event) => {
									const file = event.target.files?.[0];
									if (file !== void 0) upload(field, file);
								}
							})
						]
					});
				}
				if (control === "select") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					className: "loomloomSelect",
					value: String(value ?? ""),
					onChange: (event) => {
						updateField(field, event.target.value);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "",
						children: t("selectPlaceholder")
					}), (field.enumValues ?? []).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: option,
						children: option
					}, option))]
				});
				if (control === "checkbox") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "loomloomCheckboxRow",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: value === true,
						onChange: (event) => {
							updateField(field, event.target.checked);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: field.placeholder ?? field.label })]
				});
				if (control === "textarea") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					className: "loomloomTextarea",
					rows: 4,
					value: String(value ?? ""),
					placeholder: field.placeholder ?? field.description,
					onChange: (event) => {
						updateField(field, event.target.value);
					}
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					className: "loomloomInput",
					type: control === "number" ? "number" : "text",
					value: String(value ?? ""),
					placeholder: field.placeholder ?? field.description,
					onChange: (event) => {
						const raw = event.target.value;
						updateField(field, control === "number" && raw !== "" ? Number.parseInt(raw, 10) : raw);
					}
				});
			};
			const notice = (tone, body, key) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "loomloomAlert",
				"data-tone": tone,
				role: tone === "danger" ? "alert" : "status",
				children: [tone !== "info" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: body })]
			}, key);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "loomloomMarketPage",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "loomloomMarketPanel",
						role: "region",
						"aria-labelledby": "loomloom-market-title",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
							className: "loomloomMarketHeader",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "loomloomMarketHeaderInner",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "loomloomMarketHeaderMain",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "loomloomMarketEyebrow",
											children: t("marketEyebrow")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
											id: "loomloom-market-title",
											children: t("marketTitle")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "loomloomMarketSubtitle",
											children: t("marketSubtitle")
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "loomloomMarketToolbar",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										className: "loomloomMarketSearch",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, {}),
										type: "search",
										value: query,
										placeholder: t("marketSearchPlaceholder"),
										"aria-label": t("marketSearchLabel"),
										onChange: (event) => {
											setQuery(event.target.value);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										className: "loomloomButton",
										type: "button",
										onClick: () => void load(true),
										disabled: busy,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}), busy ? t("loading") : t("refresh")]
									})]
								})]
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "loomloomMarketBody",
							children: [
								state?.ok === false && notice("danger", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: state.message }), "load"),
								formError !== void 0 && preview === void 0 && !authorizing && notice("danger", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: formError }), "form"),
								storefront?.error !== void 0 && notice("warning", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("storefrontRefreshFailed", { message: storefront.error }) }), "stale"),
								storefront !== void 0 && storefront.unavailable.length > 0 && notice("warning", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("storefrontUnavailable", { count: storefront.unavailable.length }) }), "unavailable"),
								storefront !== void 0 && !storefront.configured ? notice("info", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: storefront.source === "creator-key-missing" ? t("storefrontCreatorKeyMissing") : t("storefrontUnconfigured") }), storefront.source !== "creator-key-missing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("storefrontUnconfiguredHint") })] }), "unconfigured") : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [busy && storefront === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "loomloomMarketSummary",
									role: "status",
									children: t("loading")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "loomloomMarketCards",
									"aria-hidden": "true",
									children: SKELETON_CARDS.map((index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "loomloomMarketSkeleton",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
										]
									}, index))
								})] }), !(busy && storefront === void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "loomloomMarketSummary",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("marketSkillbots") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("marketCount", { count: entries.length }) })]
								}), visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "loomloomEmptyBand",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: query.trim() === "" ? t("marketEmpty") : t("marketSearchEmpty") })
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "loomloomMarketCards",
									children: visible.map((entry) => {
										const creator = entry.creatorNickname;
										const updated = updatedText(entry.updatedAt);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
											className: "loomloomMarketCard",
											"aria-label": entry.name,
											"aria-disabled": !entry.available,
											role: "button",
											tabIndex: entry.available ? 0 : -1,
											onClick: (event) => {
												if (entry.available && !starting && !isNestedControl(event.target)) invoke(entry);
											},
											onKeyDown: (event) => {
												if ((event.key === "Enter" || event.key === " ") && entry.available && !starting && !isNestedControl(event.target)) {
													event.preventDefault();
													invoke(entry);
												}
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "loomloomMarketCardHead",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "loomloomMarketAvatar",
															"aria-hidden": "true",
															children: monogram(creator ?? entry.name)
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: "loomloomMarketCardTitle",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: entry.name }), creator !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("marketCreator", { name: creator }) })]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "loomloomChip",
															"data-tone": entry.available ? "success" : "neutral",
															children: entry.available ? t("available") : t("unavailable")
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "loomloomMarketChips",
													children: [
														entry.version !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: "loomloomChip",
															"data-tone": "info",
															children: [
																t("versionLabel"),
																" ",
																entry.version
															]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "loomloomChip",
															"data-tone": "outline",
															children: t("marketInputs", { count: entry.fields.length })
														}),
														updated !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "loomloomChip",
															"data-tone": "quiet",
															children: t("marketUpdated", { date: updated })
														})
													]
												}),
												entry.description !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "loomloomMarketDesc",
													children: entry.description
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "loomloomMarketCardFoot",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "loomloomMarketFee",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: feeText(entry, t("free")) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("fee") })]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "loomloomMarketActions",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
															className: "loomloomButton loomloomButtonPrimary",
															type: "button",
															disabled: !entry.available || starting,
															"aria-label": `${t("callInChat")}: ${entry.name}`,
															onClick: () => void invoke(entry),
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutline16, {}), t("callInChat")]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
															className: "loomloomButton",
															type: "button",
															"aria-label": `${t("previewInputs")}: ${entry.name}`,
															onClick: () => {
																openPreview(entry);
															},
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconListPenOutline16, {}), t("previewInputsShort")]
														})]
													})]
												})
											]
										}, entry.id);
									})
								})] })] })
							]
						})]
					}),
					preview !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: true,
						onClose: closePreview,
						title: `${t("previewTitle")} · ${preview.name}`,
						closeLabel: t("closeCall"),
						className: "loomloomDialog",
						contentClassName: "loomloomDialogScroll",
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "loomloomDialogFooter",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "loomloomFeeBar",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("previewFeeBarTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("previewFeeBarNote") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "loomloomFeeBarValue",
									children: feeText(preview, t("free"))
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								className: "loomloomButton loomloomButtonPrimary loomloomButtonBlock",
								type: "button",
								disabled: !preview.available || starting,
								onClick: submitPreview,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutline16, {}), starting ? t("preparingCall") : t("callInChat")]
							})]
						}),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "loomloomDialogBody",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "loomloomDialogMeta",
									children: [
										preview.creatorNickname !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("marketCreator", { name: preview.creatorNickname }) }),
										preview.version !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											t("versionLabel"),
											" ",
											preview.version
										] }),
										preview.updatedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											t("updatedAtLabel"),
											" ",
											new Date(preview.updatedAt).toLocaleString()
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											t("fee"),
											" ",
											feeText(preview, t("free"))
										] })
									]
								}),
								preview.description !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "loomloomDialogText",
									children: preview.description
								}),
								formError !== void 0 && notice("danger", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: formError }), "dialog-error"),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "loomloomDialogSection",
									"aria-label": t("schema"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("schema") }), preview.fields.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "loomloomDialogText",
										children: t("noSchema")
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "loomloomFieldList",
										children: preview.fields.map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: "loomloomFieldRow",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "loomloomFieldLabel",
													children: [field.label, field.required && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "loomloomFieldRequired",
														"aria-hidden": "true",
														children: "*"
													})]
												}),
												fieldInput(field),
												field.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
													className: "loomloomFieldNote",
													children: field.description
												})
											]
										}, field.key))
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "loomloomDialogSection",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("previewStepsTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
										className: "loomloomSteps",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 12 }), t("previewStepRead")] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 12 }), t("previewStepQuote")] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 12 }), t("previewStepApprove")] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 12 }), t("previewStepResult")] })
										]
									})]
								})
							]
						})
					}),
					authorizing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: true,
						onClose: onDeclined,
						title: t("authRequired"),
						description: t("authContinueHint"),
						closeLabel: t("closeCall"),
						className: "loomloomDialog",
						contentClassName: "loomloomDialogScroll",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoomloomConnectFlow, {
							t,
							onConnected,
							onLater: onDeclined
						})
					})
				]
			});
		}
		//#endregion
		//#region src/market/client/result-view.ts
		/** Payload revision this client understands. */
		const SUPPORTED_VERSION = 1;
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		function strings(value) {
			return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : void 0;
		}
		function count(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}
		function optionalString(value) {
			return typeof value === "string" && value !== "" ? value : void 0;
		}
		/** Narrows one described payload. */
		function payloadView(value) {
			const source = record(value);
			if (source === void 0) return void 0;
			switch (source.kind) {
				case "table": {
					const columns = strings(source.columns);
					const rows = Array.isArray(source.rows) ? source.rows.map(strings) : void 0;
					if (columns === void 0 || rows === void 0 || rows.some((row) => row === void 0)) return void 0;
					return {
						kind: "table",
						columns,
						rows,
						totalRows: count(source.totalRows),
						omittedColumns: count(source.omittedColumns)
					};
				}
				case "fields": {
					const rows = Array.isArray(source.rows) ? source.rows.map(strings) : void 0;
					if (rows === void 0 || rows.some((row) => row === void 0 || row.length !== 2)) return void 0;
					return {
						kind: "fields",
						rows
					};
				}
				case "scalars": {
					const rows = strings(source.rows);
					return rows === void 0 ? void 0 : {
						kind: "scalars",
						rows
					};
				}
				case "text": return typeof source.text === "string" ? {
					kind: "text",
					text: source.text
				} : void 0;
				case "empty": return {
					kind: "empty",
					reason: typeof source.reason === "string" ? source.reason : "unknown"
				};
				default: return;
			}
		}
		/** Narrows one artifact. */
		function artifactView(value) {
			const source = record(value);
			if (source === void 0 || typeof source.id !== "string" || typeof source.label !== "string") return void 0;
			const view = source.view === void 0 ? void 0 : payloadView(source.view);
			return {
				id: source.id,
				label: source.label,
				...optionalString(source.mimeType) === void 0 ? {} : { mimeType: optionalString(source.mimeType) },
				...optionalString(source.accessUrl) === void 0 ? {} : { accessUrl: optionalString(source.accessUrl) },
				...view === void 0 ? {} : { view },
				...source.truncated === true ? { truncated: true } : {}
			};
		}
		/**
		* Narrows a persisted presentation payload.
		* @param meta - the `tool/result` meta value, of unknown shape on the wire.
		* @returns the readable result, or undefined when this client cannot read it.
		*/
		function readRunResultMeta(meta) {
			const source = record(meta);
			if (source === void 0 || source.v !== SUPPORTED_VERSION || typeof source.status !== "string") return void 0;
			const counts = record(source.counts) ?? {};
			const artifacts = Array.isArray(source.artifacts) ? source.artifacts.map(artifactView).filter((entry) => entry !== void 0) : [];
			return {
				...optionalString(source.runId) === void 0 ? {} : { runId: optionalString(source.runId) },
				status: source.status,
				...source.pending === true ? { pending: true } : {},
				total: count(counts.total),
				completed: count(counts.completed),
				failed: count(counts.failed),
				...optionalString(source.currency) === void 0 ? {} : { currency: optionalString(source.currency) },
				artifacts,
				...typeof source.omittedArtifacts === "number" ? { omittedArtifacts: source.omittedArtifacts } : {},
				...source.truncated === true ? { truncated: true } : {}
			};
		}
		/**
		* The model-facing text of a settled call, used when no readable payload exists.
		*
		* Older sessions were logged before the Host projected a payload, and a call
		* nested under a composite transport never gets one at all; both must still draw
		* something truthful.
		* @param content - the call's result content blocks.
		* @returns the concatenated text blocks, or an empty string.
		*/
		function textFromContent(content) {
			return content.flatMap((block) => {
				const source = record(block);
				return source !== void 0 && source.type === "text" && typeof source.text === "string" ? [source.text] : [];
			}).join("\n\n").trim();
		}
		//#endregion
		//#region src/market/client/LoomloomRunResultCard.tsx
		/** Rows drawn before the table offers to expand. */
		const VISIBLE_ROWS = 8;
		/** Status dot + chip tone for one run status string. */
		function statusTone(status) {
			switch (status) {
				case "completed":
				case "succeeded":
				case "success": return {
					state: "done",
					tone: "success"
				};
				case "failed":
				case "error": return {
					state: "error",
					tone: "danger"
				};
				case "running":
				case "pending":
				case "queued": return {
					state: "ongoing",
					tone: "info"
				};
				default: return {
					state: "warning",
					tone: "neutral"
				};
			}
		}
		/** Rows a table draws before its artifact needs the expand control. */
		function hiddenRowCount(meta) {
			return meta.artifacts.reduce((max, artifact) => {
				const view = artifact.view;
				if (view?.kind !== "table") return max;
				return Math.max(max, view.rows.length);
			}, 0);
		}
		/** One artifact payload drawn as a table, text or an empty note. */
		function PayloadBlock({ view, expanded, t }) {
			switch (view.kind) {
				case "table": {
					const rows = expanded ? view.rows : view.rows.slice(0, VISIBLE_ROWS);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomResultTableWrap",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
							className: "loomloomResultTable",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: view.columns.map((column, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: column }, `${String(index)}-${column}`)) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row, rowIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: view.columns.map((_, columnIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row[columnIndex] ?? "" }, columnIndex)) }, rowIndex)) })]
						})
					});
				}
				case "fields": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "loomloomResultTableWrap",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("table", {
						className: "loomloomResultTable",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: view.rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							scope: "row",
							children: row[0] ?? ""
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row[1] ?? "" })] }, index)) })
					})
				});
				case "scalars": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "loomloomResultTableWrap",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("table", {
						className: "loomloomResultTable",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: view.rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row }) }, index)) })
					})
				});
				case "text": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
					text: view.text,
					labels: {
						code: {
							copyLabel: t("markdownCopy"),
							copiedLabel: t("markdownCopied")
						},
						footnotes: t("markdownFootnotes")
					}
				});
				case "empty": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "loomloomResultNote",
					children: t("runEmptyPayload")
				});
			}
		}
		/** One artifact: head, download link, payload and the elision notes. */
		function ArtifactBlock({ artifact, expanded, t }) {
			const table = artifact.view?.kind === "table" ? artifact.view : void 0;
			const notes = [];
			if (table !== void 0 && table.totalRows > table.rows.length) notes.push(t("runShownRows", {
				shown: table.rows.length,
				total: table.totalRows
			}));
			if (table !== void 0 && table.omittedColumns > 0) notes.push(t("runOmittedColumns", { count: table.omittedColumns }));
			if (artifact.truncated === true) notes.push(t("runTruncated"));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "loomloomResultArtifact",
				"aria-label": artifact.label,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "loomloomResultArtifactHead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: artifact.label }),
							artifact.mimeType !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "loomloomChip",
								"data-tone": "neutral",
								children: artifact.mimeType
							}),
							artifact.accessUrl !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								href: artifact.accessUrl,
								target: "_blank",
								rel: "noreferrer",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, { size: 14 }), t("runDownload")]
							})
						]
					}),
					artifact.view === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomResultNote",
						children: t("runEmptyPayload")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PayloadBlock, {
						view: artifact.view,
						expanded,
						t
					}),
					notes.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomResultNote",
						children: notes.join(" · ")
					})
				]
			});
		}
		/**
		* The conversation card for `loomloom_execute_skillbot` and
		* `loomloom_get_run_results`.
		*
		* It draws the Host's structured payload — status, row counts, one block per
		* output artifact with a real table and a download link — so the artefact the
		* user paid for is the readable thing on screen. A call with no readable payload
		* (an older session, or a nested transport) falls back to the model-facing text
		* rather than an empty card.
		*/
		function LoomloomRunResultCard({ block, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			const settled = block.kind === "tool-result" ? block : void 0;
			const meta = (0, react.useMemo)(() => settled === void 0 ? void 0 : readRunResultMeta(settled.meta), [settled]);
			const copyRunId = (0, react.useCallback)((runId) => {
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(runId).then((result) => {
					if (result !== true) return;
					setCopied(true);
					window.setTimeout(() => {
						setCopied(false);
					}, 1600);
				});
			}, []);
			if (settled === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "loomloomResultCard",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "loomloomResultHead",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("runCardTitle") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "loomloomChip",
							"data-tone": "info",
							children: t("runStatusRunning")
						})
					]
				})
			});
			if (settled.isError) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "loomloomResultCard",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "loomloomResultHead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("runCardTitle") })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "loomloomAlert",
					"data-tone": "danger",
					children: textFromContent(settled.content) || t("error")
				})]
			});
			if (meta === void 0) {
				const text = textFromContent(settled.content);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "loomloomResultCard",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "loomloomResultHead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "done" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("runCardTitle") })]
					}), text === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomResultNote",
						children: t("runEmptyPayload")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text,
						labels: {
							code: {
								copyLabel: t("markdownCopy"),
								copiedLabel: t("markdownCopied")
							},
							footnotes: t("markdownFootnotes")
						}
					})]
				});
			}
			const tone = statusTone(meta.status);
			const runId = meta.runId;
			const drawnRows = hiddenRowCount(meta);
			const trailing = drawnRows > VISIBLE_ROWS;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "loomloomResultCard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "loomloomResultHead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: tone.state }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("runCardTitle") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "loomloomChip",
								"data-tone": tone.tone,
								children: meta.status
							}),
							runId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								className: "loomloomIconButton",
								type: "button",
								onClick: () => {
									copyRunId(runId);
								},
								children: [copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, { size: 14 }), copied ? t("runCopied") : t("runCopyId")]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: "loomloomResultStats",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "loomloomStat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runStatsRows") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: meta.total })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "loomloomStat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runCompleted") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: meta.completed })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "loomloomStat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("runFailed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: meta.failed })]
							})
						]
					}),
					meta.artifacts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomResultNote",
						children: t("runNoArtifacts")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "loomloomResultArtifacts",
						children: meta.artifacts.map((artifact) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArtifactBlock, {
							artifact,
							expanded,
							t
						}, artifact.id))
					}),
					trailing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "loomloomIconButton",
						type: "button",
						onClick: () => {
							setExpanded(!expanded);
						},
						children: expanded ? t("runShowLess") : t("runShowAll", { count: drawnRows })
					}),
					meta.omittedArtifacts !== void 0 && meta.omittedArtifacts > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomResultNote",
						children: t("runOmittedArtifacts", { count: meta.omittedArtifacts })
					}),
					meta.truncated === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "loomloomResultNote",
						children: t("runTruncated")
					})
				]
			});
		}
		//#endregion
		//#region src/market/client/LoomloomSidebarNavigation.tsx
		function LoomloomSidebarNavigation({ t, wide }) {
			const active = useLoomloomMarketActive();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				className: "loomloomSidebarNav",
				type: "button",
				title: wide ? void 0 : t("marketEntry"),
				"aria-label": t("marketEntry"),
				"aria-current": active ? "page" : void 0,
				"data-wide": wide || void 0,
				onClick: () => {
					setLoomloomMarketActive(!active);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "loomloomMarketGlyph",
					"aria-hidden": "true",
					children: "云"
				}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "loomloomSidebarNavLabel",
					children: t("marketEntry")
				})]
			});
		}
		//#endregion
		//#region src/market/client/locales.ts
		const zh = {
			tab: "Loomloom",
			title: "Loomloom SkillBot",
			subtitle: "浏览可用的胜算云 Market SkillBot，并在 DSH 聊天中安全执行。",
			credentialReady: "已配置凭据",
			credentialMissing: "尚未登录",
			credentialHint: "点击下方按钮，在浏览器中完成胜算云授权。凭据不会显示在此页面。",
			signIn: "注册或登录胜算云",
			signingIn: "正在打开登录…",
			signInWaiting: "请在浏览器中完成授权；此页面会自动更新。",
			signInFailed: "登录未完成，请重试。",
			onboardingTitle: "连接胜算云，开始聊天与 Loomloom",
			connectionTitle: "胜算云连接",
			connectDescription: "注册或登录后，胜算云 API Key 将安全保存在此 DSH Profile 中，同时用于聊天模型与 Loomloom。",
			connectionDetails: "这会发生什么",
			connectionDetailsBody: "DSH 会打开系统浏览器完成注册或登录，在本机回调后分别验证 Loomloom 与聊天模型，再保存设置。你可以随时在设置中退出。",
			connectionPrivacy: "DSH Desktop 不收集或展示密码、验证码或 API Key。",
			connectLater: "暂不连接",
			waitingBrowser: "等待浏览器授权",
			verifyingLoom: "验证 Loomloom",
			verifyingRouter: "验证聊天模型",
			savingConnection: "保存设置",
			browserUnavailable: "无法打开系统浏览器。你可以复制授权链接后手动打开。",
			copyAuthorizationLink: "复制授权链接",
			copyLinkFailed: "无法复制授权链接，请重试。",
			cancelSignIn: "取消等待",
			cancelFailed: "取消登录失败，请重试。",
			authorizationCancelled: "授权已取消。可以重新发起连接。",
			authorizationTimedOut: "未在规定时间完成授权。请重新发起连接。",
			loomValidationFailed: "该 API Key 无法访问 Loomloom，请重新授权。",
			routerValidationFailed: "该 API Key 无法访问胜算云聊天模型，请重新授权。",
			noChatModel: "账号当前没有可用聊天模型，请稍后重试或联系胜算云支持。",
			credentialSaveFailed: "验证已通过，但保存设置失败。请重试。",
			connectionStatusFailed: "无法确认胜算云连接状态，请重试。",
			modelSelectionRequired: "凭据已验证。请选择一个可用的胜算云聊天模型后再完成连接。",
			openModels: "打开模型设置",
			modelSelectionLater: "稍后设置",
			loomReady: "Loomloom 可用",
			chatModelReady: "聊天模型可用",
			connectedHint: "胜算云已连接，可以开始聊天。",
			createFirstChat: "创建第一段聊天",
			signOut: "退出登录",
			signingOut: "正在退出…",
			refresh: "刷新",
			loadMore: "加载更多",
			loading: "正在加载…",
			empty: "当前账户没有可显示的 SkillBot。",
			unavailable: "暂不可执行",
			available: "可执行",
			fee: "固定费用",
			schema: "公开输入字段",
			required: "必填",
			optional: "可选",
			inputHint: "字段信息仅用于准备输入；不会显示任何内部工作流。",
			chatExecution: "请在 DSH 聊天中执行",
			chatExecutionDetail: "在聊天中选择 SkillBot、准备输入并获取服务端报价。每次执行都必须经 DSH 的明确批准；本页不提供执行入口。",
			noSchema: "此 SkillBot 没有公开输入字段。",
			runs: "最近运行",
			noRuns: "暂无运行记录。",
			runRefresh: "刷新状态",
			error: "无法加载 Loomloom 信息。",
			account: "胜算云账户",
			accountConnected: "已连接",
			signInPrompt: "注册或登录后开始聊天",
			accountId: "用户 ID",
			balance: "余额",
			accountRole: "身份",
			creator: "创作者",
			user: "普通用户",
			close: "关闭",
			accountUnavailable: "账户资料暂时不可用，连接本身仍然有效。",
			refreshAccount: "重新登录以加载账户资料",
			marketEntry: "云端 SkillBot",
			marketEyebrow: "LoomLoom Market",
			marketTitle: "云端 SkillBot 市场",
			marketSkillbots: "可用技能体",
			marketEmpty: "当前没有可用 SkillBot。",
			free: "免费",
			selectPlaceholder: "请选择",
			storefrontUnconfigured: "此构建尚未配置店面。",
			storefrontCreatorKeyMissing: "店面需要创作者凭据来获取作品列表，但当前环境未提供。请配置后重启应用。",
			storefrontUnconfiguredHint: "客户端只展示构建期配置的已上架 SkillBot；请联系维护者补充 storefrontListingIds。",
			storefrontUnavailable: "有 {count} 个 SkillBot 已下架，不再展示。",
			staleStorefront: "当前显示的是上次缓存结果，刷新未成功。",
			storefrontRefreshFailed: "店面刷新失败：{message}",
			versionLabel: "版本",
			updatedAtLabel: "更新时间",
			creatorLabel: "创作者",
			closeCall: "关闭",
			requiredMissing: "请先填写所有必填项。",
			chooseFile: "选择文件",
			uploading: "正在上传…",
			uploadFailed: "文件上传失败，请重试。",
			clearFile: "移除",
			promptInvocation: [
				"请通过 Loomloom 工具调用云端 SkillBot。",
				"- SkillBot：{name}",
				"- listing id：{listingId}",
				"- 我已填写的输入：",
				"{input}",
				"",
				"必须严格遵守以下交互流程：",
				"1. 先调用 loomloom_get_skillbot 读取真实字段、必填状态、说明和枚举选项。",
				"2. 如果上面的输入为空，或缺少任何必填字段，必须调用 ask_user_question 展示交互式问题；不得用普通文字代替提问，不得跳过提问，也不得自行猜测或补全答案。",
				"3. 等待 ask_user_question 返回答案后，将答案映射为 input_rows；在答案返回前禁止调用 loomloom_prepare_execution。",
				"4. 使用 loomloom_prepare_execution 生成草稿并告知预估费用；经我明确确认后，才能调用 loomloom_execute_skillbot。",
				"5. 最后用 loomloom_get_run 与 loomloom_get_run_results 汇总结果，并整理成易读的表格。",
				"如果 ask_user_question 不可用，必须说明交互输入能力不可用并停止，不得退化为普通文字提问或继续执行。"
			].join("\n"),
			promptNoInput: "（本次没有提供任何输入；必须通过 ask_user_question 收集字段答案后才能继续）",
			previewInputs: "预览输入项",
			previewTitle: "输入项",
			callInChat: "在对话中调用",
			authRequired: "调用云端 SkillBot 前需要先连接胜算云。",
			authContinueHint: "授权成功后会自动回到对话并继续这次调用。",
			credentialUnavailable: "无法确认胜算云授权状态，请重试。",
			sendFailed: "未能在对话中发起调用。",
			preparingCall: "正在发起…",
			marketSubtitle: "每位创作者的一方 SkillBot 工作站：在这里填好输入项，调用与结果都发生在 DSH 对话里。",
			marketSearchPlaceholder: "搜索名称或简介…",
			marketSearchLabel: "搜索 SkillBot",
			marketSearchEmpty: "没有匹配的 SkillBot。",
			marketCount: "共 {count} 个可用 SkillBot",
			marketInputs: "输入项 {count} 项",
			marketUpdated: "更新于 {date}",
			marketCreator: "创作者 {name}",
			previewInputsShort: "输入项",
			previewStepsTitle: "提交后会发生什么",
			previewStepRead: "先读取并校验公开输入字段",
			previewStepQuote: "生成执行草稿并给出预估费用",
			previewStepApprove: "费用需你确认后才执行",
			previewStepResult: "运行结果回到这个新会话里",
			previewFeeBarTitle: "本次调用费用",
			previewFeeBarNote: "费用由服务端在执行前确认，未执行不产生费用。",
			dropzoneTitle: "点击选择文件上传",
			dropzoneHint: "支持 {types}",
			dropzoneChosen: "已上传",
			runCardTitle: "SkillBot 运行结果",
			runStatusRunning: "正在运行",
			runStatsRows: "总行数",
			runCompleted: "已完成",
			runFailed: "失败",
			runArtifacts: "输出产物",
			runNoArtifacts: "本次运行没有输出产物。",
			runDownload: "下载",
			runCopyId: "复制运行 ID",
			runCopied: "已复制",
			runTruncated: "内容已截断",
			runOmittedArtifacts: "另有 {count} 个产物未展示",
			runShownRows: "显示 {shown} / {total} 行",
			runOmittedColumns: "省略 {count} 列",
			runShowAll: "展开全部 {count} 行",
			runShowLess: "收起",
			runEmptyPayload: "该产物没有可展示的内容。",
			markdownCopy: "复制",
			markdownCopied: "已复制",
			markdownFootnotes: "脚注"
		};
		const en = {
			tab: "Loomloom",
			title: "Loomloom SkillBots",
			subtitle: "Browse ShengSuanYun Market SkillBots and execute safely from DSH chat.",
			credentialReady: "Credential configured",
			credentialMissing: "Sign-in required",
			credentialHint: "Use the button below to complete ShengSuanYun authorization in your browser. Credentials never appear here.",
			signIn: "Register or sign in to ShengSuanYun",
			signingIn: "Opening sign-in…",
			signInWaiting: "Complete authorization in your browser; this page will update automatically.",
			signInFailed: "Sign-in did not complete. Please try again.",
			onboardingTitle: "Connect ShengSuanYun for chat and Loomloom",
			connectionTitle: "ShengSuanYun connection",
			connectDescription: "After registration or sign-in, one ShengSuanYun API key is stored securely in this DSH Profile for both chat models and Loomloom.",
			connectionDetails: "What happens",
			connectionDetailsBody: "DSH opens your system browser, receives a local callback, verifies Loomloom and chat access separately, then saves the settings. You can sign out at any time.",
			connectionPrivacy: "DSH Desktop never collects or displays passwords, verification codes, or API keys.",
			connectLater: "Not now",
			waitingBrowser: "Waiting for browser authorization",
			verifyingLoom: "Verifying Loomloom",
			verifyingRouter: "Verifying chat models",
			savingConnection: "Saving settings",
			browserUnavailable: "The system browser could not be opened. Copy the authorization link and open it manually.",
			copyAuthorizationLink: "Copy authorization link",
			copyLinkFailed: "The authorization link could not be copied. Please try again.",
			cancelSignIn: "Cancel waiting",
			cancelFailed: "Sign-in could not be cancelled. Please try again.",
			authorizationCancelled: "Authorization was cancelled. You can start again.",
			authorizationTimedOut: "Authorization was not completed in time. Please start again.",
			loomValidationFailed: "This API key cannot access Loomloom. Please authorize again.",
			routerValidationFailed: "This API key cannot access ShengSuanYun chat models. Please authorize again.",
			noChatModel: "This account currently has no compatible chat model. Try later or contact ShengSuanYun support.",
			credentialSaveFailed: "Verification succeeded, but the settings could not be saved. Please try again.",
			connectionStatusFailed: "The ShengSuanYun connection could not be verified. Please try again.",
			modelSelectionRequired: "The credential is verified. Select an available ShengSuanYun chat model to finish connecting.",
			openModels: "Open model settings",
			modelSelectionLater: "Set up later",
			loomReady: "Loomloom available",
			chatModelReady: "Chat model available",
			connectedHint: "ShengSuanYun is connected and ready for chat.",
			createFirstChat: "Create first chat",
			signOut: "Sign out",
			signingOut: "Signing out…",
			refresh: "Refresh",
			loadMore: "Load more",
			loading: "Loading…",
			empty: "No SkillBots are available for this account.",
			unavailable: "Unavailable",
			available: "Available",
			fee: "Fixed fee",
			schema: "Public input fields",
			required: "Required",
			optional: "Optional",
			inputHint: "These fields are for input preparation only; internal workflows are never displayed.",
			chatExecution: "Execute in DSH chat",
			chatExecutionDetail: "Select a SkillBot in chat, prepare inputs, and obtain a server quote. Every execution requires explicit DSH approval; this page has no execution control.",
			noSchema: "This SkillBot exposes no public input fields.",
			runs: "Recent runs",
			noRuns: "No runs yet.",
			runRefresh: "Refresh status",
			error: "Unable to load Loomloom information.",
			account: "ShengSuanYun account",
			accountConnected: "Connected",
			signInPrompt: "Register or sign in to start chatting",
			accountId: "User ID",
			balance: "Balance",
			accountRole: "Role",
			creator: "Creator",
			user: "User",
			close: "Close",
			accountUnavailable: "Account details are temporarily unavailable; the connection is still active.",
			refreshAccount: "Sign in again to load account details",
			marketEntry: "Cloud SkillBots",
			marketEyebrow: "LoomLoom Market",
			marketTitle: "Cloud SkillBot Market",
			marketSkillbots: "Available SkillBots",
			marketEmpty: "No SkillBots are currently available.",
			free: "Free",
			selectPlaceholder: "Select an option",
			storefrontUnconfigured: "No storefront is configured for this build.",
			storefrontCreatorKeyMissing: "The storefront needs a creator credential to list their SkillBots, and the environment did not provide one. Configure it and restart.",
			storefrontUnconfiguredHint: "This client only presents SkillBots fixed at build time; ask the maintainer to set storefrontListingIds.",
			storefrontUnavailable: "{count} SkillBot(s) are no longer listed and have been hidden.",
			staleStorefront: "Showing the last cached result; the refresh did not succeed.",
			storefrontRefreshFailed: "The storefront refresh failed: {message}",
			versionLabel: "Version",
			updatedAtLabel: "Updated",
			creatorLabel: "Creator",
			closeCall: "Close",
			requiredMissing: "Fill in every required field first.",
			chooseFile: "Choose file",
			uploading: "Uploading…",
			uploadFailed: "The file could not be uploaded. Please try again.",
			clearFile: "Remove",
			promptInvocation: [
				"Please invoke the cloud SkillBot through the Loomloom tools.",
				"- SkillBot: {name}",
				"- listing id: {listingId}",
				"- inputs I filled in:",
				"{input}",
				"",
				"You MUST follow this interaction protocol:",
				"1. First call loomloom_get_skillbot to read the real fields, required flags, descriptions and enum options.",
				"2. If the input above is empty or any required field is missing, you MUST call ask_user_question to show interactive questions. Do not replace it with a plain-text question, skip it, invent values or guess answers.",
				"3. Wait for ask_user_question to return. Map its answers to input_rows; do not call loomloom_prepare_execution before the answers are returned.",
				"4. Call loomloom_prepare_execution to create a draft and report the estimated fee. Only call loomloom_execute_skillbot after I explicitly approve.",
				"5. Finally call loomloom_get_run and loomloom_get_run_results and present the result as a readable table.",
				"If ask_user_question is unavailable, report that interactive input is unavailable and stop. Do not fall back to a plain-text question or continue execution."
			].join("\n"),
			promptNoInput: "(No inputs were provided; you MUST collect the field answers with ask_user_question before continuing.)",
			previewInputs: "Preview inputs",
			previewTitle: "Inputs",
			callInChat: "Call in chat",
			authRequired: "Connecting ShengSuanYun is required before calling a cloud SkillBot.",
			authContinueHint: "After authorizing, this call continues in the conversation automatically.",
			credentialUnavailable: "The ShengSuanYun connection could not be confirmed. Please try again.",
			sendFailed: "The call could not be started in the conversation.",
			preparingCall: "Starting…",
			marketSubtitle: "One creator’s SkillBot workstation: prepare the inputs here; the call and its result happen in the DSH conversation.",
			marketSearchPlaceholder: "Search name or description…",
			marketSearchLabel: "Search SkillBots",
			marketSearchEmpty: "No SkillBot matches this search.",
			marketCount: "{count} SkillBot(s) available",
			marketInputs: "{count} input(s)",
			marketUpdated: "Updated {date}",
			marketCreator: "By {name}",
			previewInputsShort: "Inputs",
			previewStepsTitle: "What happens after you submit",
			previewStepRead: "The public input fields are read and validated first",
			previewStepQuote: "A draft is created and the estimated fee is quoted",
			previewStepApprove: "Nothing runs until you approve that fee",
			previewStepResult: "The run result lands back in the new conversation",
			previewFeeBarTitle: "Cost of this call",
			previewFeeBarNote: "The server confirms the fee before execution; a call that never runs is not charged.",
			dropzoneTitle: "Click to choose a file",
			dropzoneHint: "Accepts {types}",
			dropzoneChosen: "Uploaded",
			runCardTitle: "SkillBot run result",
			runStatusRunning: "Running",
			runStatsRows: "Rows",
			runCompleted: "Completed",
			runFailed: "Failed",
			runArtifacts: "Output artifacts",
			runNoArtifacts: "This run produced no output artifacts.",
			runDownload: "Download",
			runCopyId: "Copy run id",
			runCopied: "Copied",
			runTruncated: "Content truncated",
			runOmittedArtifacts: "{count} more artifact(s) not shown",
			runShownRows: "Showing {shown} of {total} rows",
			runOmittedColumns: "{count} more column(s) omitted",
			runShowAll: "Show all {count} rows",
			runShowLess: "Show less",
			runEmptyPayload: "This artifact has no displayable content.",
			markdownCopy: "Copy",
			markdownCopied: "Copied",
			markdownFootnotes: "Footnotes"
		};
		//#endregion
		//#region src/market/client/styles.ts
		const STYLE_ID = "dsh-plugin-loomloom/styles";
		/**
		* The plugin's single global stylesheet.
		*
		* The package has no CSS-modules pipeline (its client bundle is a plain tsdown
		* CommonJS factory), so every rule lives here and rides the platform's semantic
		* `--dsw-*` tokens. Two token rules matter for legibility in the light theme,
		* where `--dsw-alias-bg-base` and every `--dsw-alias-bg-layer-*` resolve to the
		* same white:
		*
		* 1. A page that must separate from the chat canvas uses
		*    `--dsw-specific-sidebar-fill` (the tinted surface DSH itself uses for the
		*    sidebar); cards on it use `--dsw-alias-bg-layer-1`.
		* 2. Outlines use `--dsw-alias-border-l3` (12%) and controls
		*    `--dsw-alias-border-l4` (16%, the strength the shipped `Input` primitive
		*    uses). `--dsw-alias-border-l1` is 4% black and invisible on white, which is
		*    what previously made every card, control and separator disappear.
		*
		* Source order is load-bearing: base rules come first and variant rules after
		* them, because the two have equal specificity. `.loomloomButtonPrimary` used to
		* be written above `.loomloomButton`, so the base rule won and the primary button
		* rendered as a plain one.
		*/
		const css = `
.loomloomRoot { display: flex; flex-direction: column; gap: 16px; min-width: 0; color: var(--dsw-alias-label-primary); }
.loomloomConnectFlow { display: grid; gap: 12px; }
.loomloomFlowDescription, .loomloomFlowPrivacy, .loomloomFlowDetails p { margin: 0; font-size: 13px; line-height: 20px; }
.loomloomFlowPrivacy, .loomloomFlowDetails p { color: var(--dsw-alias-label-tertiary); }
.loomloomFlowDetails summary { cursor: pointer; font-size: 13px; font-weight: 600; }
.loomloomFlowActions, .loomloomConnectionChecks { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomConnectionChecks { color: var(--dsw-alias-state-success-primary); font-size: 13px; font-weight: 600; }
.loomloomConnectionChecks span { display: inline-flex; align-items: center; gap: 5px; }
.loomloomFlowSteps { display: grid; gap: 6px; margin: 0; padding-left: 22px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.loomloomFlowSteps li[data-current='true'] { color: var(--dsw-alias-label-primary); font-weight: 600; }
.loomloomOnboarding { width: min(560px, calc(100vw - 32px)); max-width: none; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.loomloomOnboarding::backdrop { background: var(--dsw-alias-bg-mask-1); }
.loomloomOnboardingContent { display: grid; gap: 16px; padding: 24px; }
.loomloomOnboardingContent h2 { margin: 0; font-size: 20px; line-height: 28px; }
.loomloomHeader, .loomloomCardTop, .loomloomFieldHead { display: flex; align-items: center; gap: 10px; }
.loomloomHeader { align-items: flex-start; justify-content: space-between; }
.loomloomHeader h2, .loomloomCard h3, .loomloomDetail h3 { margin: 0; font-weight: 600; }
.loomloomHeader h2 { font-size: 18px; line-height: 26px; }
.loomloomHeader p, .loomloomCard p, .loomloomNote p, .loomloomField p { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }

/* ── Alerts, notices, empty states ─────────────────────────────────────────
   The tinted fill rides color-mix on the state color, the same construction the
   shipped Tag primitive uses, so one token moves both fill and text. */
.loomloomAlert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 1px solid transparent; border-radius: 10px; font-size: 13px; line-height: 20px; }
.loomloomAlert[data-tone='danger'] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); }
.loomloomAlert[data-tone='warning'] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); color: var(--dsw-alias-state-warn-label); }
.loomloomAlert[data-tone='info'] { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.loomloomAlert svg { flex: none; margin-top: 2px; }
.loomloomAlert p { margin: 0; }

/* The dashed band, kept for the states that mean "nothing to show yet". */
.loomloomEmptyBand { display: grid; justify-items: center; gap: 6px; padding: 24px 20px; border: 1px dashed var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-module-platform); text-align: center; }
.loomloomEmptyBand strong { font-size: 14px; line-height: 22px; }
.loomloomEmptyBand p { margin: 0; max-width: 60ch; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.loomloomButton { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
.loomloomButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.loomloomButton:disabled { cursor: not-allowed; opacity: .45; }
.loomloomButton:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.loomloomButton[data-size='sm'] { min-height: 28px; padding: 3px 10px; font-size: 12px; line-height: 18px; border-radius: 14px; }
/* Declared after the base rule on purpose: equal specificity, later wins. */
.loomloomButtonPrimary { border-color: var(--dsw-alias-button-primary-fill); background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-weight: 600; }
.loomloomButtonPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); border-color: var(--dsw-alias-button-primary-hover); }
.loomloomButtonBlock { width: 100%; min-height: 38px; border-radius: 19px; font-size: 14px; }
.loomloomIconButton { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 26px; padding: 2px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.loomloomIconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.loomloomIconButton:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: none; }

/* ── Settings tab ────────────────────────────────────────────────────────── */
.loomloomNote, .loomloomEmpty, .loomloomError { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 20px; }
.loomloomError { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); }
.loomloomEmpty { color: var(--dsw-alias-label-tertiary); }
.loomloomGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.loomloomCard { appearance: none; display: flex; flex-direction: column; min-width: 0; min-height: 148px; padding: 14px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.loomloomCard:hover { border-color: var(--dsw-alias-border-l4); background: var(--dsw-alias-interactive-bg-hover); }
.loomloomCard:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.loomloomCard[aria-pressed='true'] { border-color: var(--dsw-alias-state-business-primary); }
.loomloomCard h3 { overflow: hidden; font-size: 15px; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomCard p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.loomloomBadge { margin-left: auto; padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 18px; white-space: nowrap; }
.loomloomBadge[data-available='true'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }
.loomloomMeta { margin-top: auto; padding-top: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
.loomloomDetail { padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.loomloomDetailHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.loomloomDetailHead h3 { font-size: 15px; line-height: 22px; }
.loomloomFields { display: grid; gap: 8px; margin-top: 12px; }
.loomloomRuns { display: grid; gap: 8px; margin-top: 12px; }
.loomloomRun { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.loomloomRun strong, .loomloomRun code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomRun code { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.loomloomRunStatus { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.loomloomField { padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.loomloomFieldHead strong { font-size: 13px; line-height: 20px; }
.loomloomField code { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.loomloomFieldTag { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomFieldHint { margin: 6px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomNote { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-module-platform); }
.loomloomAccountActions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.loomloomInlineWarning { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 24%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); }
.loomloomInlineWarning p { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 13px; line-height: 20px; }
.loomloomInlineWarning svg { flex: none; margin-top: 3px; }

/* ── Sidebar identity + navigation ───────────────────────────────────────── */
.loomloomIdentityAction { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 44px; padding: 6px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.loomloomIdentityAction:hover, .loomloomIdentityAction:focus-visible { border-color: var(--dsw-alias-border-l2); background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-interactive-bg-hover)); outline: none; }
.loomloomIdentityAvatar { display: inline-flex; flex: 0 0 28px; align-items: center; justify-content: center; width: 28px; height: 28px; overflow: hidden; border-radius: 50%; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 700; }
.loomloomIdentityAvatar img { width: 100%; height: 100%; object-fit: cover; }
.loomloomIdentityCopy { display: grid; min-width: 0; gap: 1px; }
.loomloomIdentityCopy strong, .loomloomIdentityCopy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomIdentityCopy strong { font-size: 13px; line-height: 18px; }
.loomloomIdentityCopy small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomIdentityDetails { display: grid; gap: 16px; }
.loomloomIdentityProfile { display: flex; align-items: center; gap: 12px; }
.loomloomIdentityAvatarLarge { width: 44px; height: 44px; flex-basis: 44px; font-size: 16px; }
.loomloomIdentityProfile div { display: grid; gap: 2px; min-width: 0; }
.loomloomIdentityProfile span { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomIdentityFacts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 16px; margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.loomloomIdentityFacts dt { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomIdentityFacts dd { margin: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomSidebarNav { appearance: none; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 5px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.loomloomSidebarNav:not([data-wide]) { justify-content: center; padding-inline: 0; }
.loomloomSidebarNav:hover, .loomloomSidebarNav:focus-visible { background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-label-primary); outline: none; }
.loomloomSidebarNav:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.loomloomSidebarNav[aria-current='page'] { background: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-label-primary); font-weight: 600; }
.loomloomSidebarNavLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketGlyph { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 6px; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground); font-size: 11px; font-weight: 700; }

/* ── Market surface ────────────────────────────────────────────────────────
   Tinted page + white cards: the same hierarchy the reference storefront uses,
   and the only pairing that stays legible in both themes given the light theme's
   flattened background layers. */
.loomloomMarketPage { width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-specific-sidebar-fill); }
.loomloomMarketPanel { display: grid; grid-template-rows: auto minmax(0, 1fr); width: 100%; height: 100%; overflow: hidden; }
.loomloomMarketHeader { padding: 26px 0 18px; border-bottom: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-base); }
.loomloomMarketHeaderInner { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; width: min(1040px, calc(100% - 96px)); margin: 0 auto; }
.loomloomMarketHeaderMain { min-width: 0; }
.loomloomMarketHeader h2 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
.loomloomMarketEyebrow { margin: 0 0 4px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.loomloomMarketSubtitle { margin: 6px 0 0; max-width: 68ch; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.loomloomMarketToolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomMarketSearch { width: min(260px, 100%); }
.loomloomMarketBody { width: min(1040px, calc(100% - 96px)); min-height: 0; overflow: auto; margin: 0 auto; padding: 20px 0 48px; }
.loomloomMarketSummary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin: 0 0 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomMarketSummary strong { color: var(--dsw-alias-label-primary); font-size: 15px; line-height: 22px; font-weight: 600; }
.loomloomMarketSummary span { font-variant-numeric: tabular-nums; }
.loomloomMarketCards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; align-items: stretch; }
.loomloomMarketCard { display: flex; flex-direction: column; min-width: 0; padding: 16px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
.loomloomMarketCard:hover { border-color: var(--dsw-alias-border-l4); }
.loomloomMarketCardHead { display: flex; align-items: center; gap: 10px; min-width: 0; }
.loomloomMarketAvatar { display: inline-flex; flex: 0 0 36px; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); font-size: 15px; font-weight: 700; }
.loomloomMarketCardTitle { display: grid; min-width: 0; gap: 2px; }
.loomloomMarketCardTitle strong { overflow: hidden; font-size: 14px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketCardTitle span { overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketChips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
/* The pinned runtime's ui-primitives ships no read-only badge (the newer source
   has Tag, the vendored 0.1.2 build does not), so the 11px capsule is local.
   Tones ride the same color-mix construction the shared atoms use. */
.loomloomChip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px solid transparent; border-radius: 999px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }
.loomloomChip[data-tone='outline'] { border-color: var(--dsw-alias-border-l4); color: var(--dsw-alias-label-secondary); }
.loomloomChip[data-tone='neutral'] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.loomloomChip[data-tone='quiet'] { color: var(--dsw-alias-label-tertiary); }
.loomloomChip[data-tone='info'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color: var(--dsw-alias-state-business-primary); }
.loomloomChip[data-tone='success'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }
.loomloomChip[data-tone='warning'] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-label); }
.loomloomChip[data-tone='danger'] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }
.loomloomMarketDesc { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; margin: 10px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.loomloomMarketCardFoot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 14px; }
.loomloomMarketFee { display: grid; gap: 1px; }
.loomloomMarketFee strong { color: var(--dsw-alias-state-business-primary); font-size: 15px; line-height: 22px; font-variant-numeric: tabular-nums; }
.loomloomMarketFee small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomMarketActions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.loomloomMarketSkeleton { display: grid; gap: 10px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
.loomloomMarketSkeleton span { height: 12px; border-radius: 6px; background: var(--dsw-alias-bg-skeleton); }
.loomloomMarketSkeleton span:nth-child(1) { width: 60%; height: 16px; }
.loomloomMarketSkeleton span:nth-child(2) { width: 90%; }
.loomloomMarketSkeleton span:nth-child(3) { width: 45%; }

/* ── Preview dialog ────────────────────────────────────────────────────────
   The shipped Modal primitive supplies the mask, radius, elevation and Escape
   handling; these rules only widen the card and lay out the form. */
.loomloomDialog { width: min(680px, calc(100vw - 48px)); max-height: min(820px, calc(100vh - 48px)); }
.loomloomDialogNarrow { width: min(420px, calc(100vw - 48px)); max-height: min(680px, calc(100vh - 48px)); }
.loomloomDialogScroll { min-height: 0; overflow: auto; }
.loomloomDialogMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomDialogMeta span { display: inline-flex; align-items: center; gap: 5px; }
.loomloomDialogBody { display: grid; gap: 16px; }
.loomloomDialogText { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.loomloomDialogSection { display: grid; gap: 10px; }
.loomloomDialogSection > h3 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.loomloomFieldList { display: grid; gap: 14px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-module-platform); }
.loomloomFieldRow { display: grid; gap: 6px; }
.loomloomFieldLabel { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 500; }
.loomloomFieldRequired { color: var(--dsw-alias-state-error-primary); }
.loomloomFieldNote { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomInput { box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }
.loomloomInput::placeholder { color: var(--dsw-alias-label-dimmed); }
.loomloomInput:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); outline-offset: 0; }
.loomloomTextarea { box-sizing: border-box; width: 100%; min-height: 76px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; resize: vertical; }
.loomloomTextarea::placeholder { color: var(--dsw-alias-label-dimmed); }
.loomloomTextarea:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); outline-offset: 0; }
.loomloomSelect { box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 30px 6px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background-color: var(--dsw-alias-bg-layer-1); background-image: linear-gradient(45deg, transparent 50%, var(--dsw-alias-label-secondary) 50%), linear-gradient(135deg, var(--dsw-alias-label-secondary) 50%, transparent 50%); background-position: calc(100% - 16px) 15px, calc(100% - 11px) 15px; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; appearance: none; }
.loomloomSelect:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); outline-offset: 0; }
.loomloomCheckboxRow { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; }
.loomloomCheckboxRow input { width: 16px; height: 16px; accent-color: var(--dsw-alias-state-business-primary); }
.loomloomDropzone { position: relative; display: grid; justify-items: center; gap: 6px; padding: 20px 16px; border: 1px dashed var(--dsw-alias-border-l4); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); text-align: center; cursor: pointer; }
.loomloomDropzone:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.loomloomDropzone[data-filled='true'] { cursor: default; }
.loomloomDropzone > svg { color: var(--dsw-alias-label-tertiary); }
.loomloomDropzone strong { font-size: 13px; line-height: 20px; font-weight: 500; }
.loomloomDropzone small { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
/* The native control stays the accessible one; the label is the affordance. */
.loomloomDropzoneInput { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.loomloomDropzoneFilled { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; }
.loomloomFileChip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 10px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.loomloomFileChip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomSteps { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.loomloomSteps li { display: flex; align-items: flex-start; gap: 6px; }
.loomloomSteps svg { flex: none; margin-top: 2px; color: var(--dsw-alias-state-success-primary); }
.loomloomFeeBar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-radius: 12px; background: var(--dsw-alias-interactive-bg-hover); }
.loomloomFeeBar div { display: grid; gap: 2px; }
.loomloomFeeBar strong { font-size: 13px; line-height: 20px; }
.loomloomFeeBar small { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomFeeBarValue { color: var(--dsw-alias-state-business-primary); font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.loomloomDialogFooter { display: grid; gap: 10px; }

/* ── Run result card ───────────────────────────────────────────────────────
   Rendered inside a conversation turn, so it borrows the tool-card shape: a
   bordered surface, a status head, then one block per output artifact. */
.loomloomResultCard { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.loomloomResultHead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomResultHead h4 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.loomloomResultStats { display: flex; flex-wrap: wrap; gap: 14px; margin: 0; }
.loomloomStat { display: grid; gap: 1px; }
.loomloomStat dt { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomStat dd { margin: 0; font-size: 13px; line-height: 20px; font-variant-numeric: tabular-nums; }
.loomloomResultArtifacts { display: grid; gap: 10px; }
.loomloomResultArtifact { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }
.loomloomResultArtifactHead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomResultArtifactHead strong { font-size: 13px; line-height: 20px; }
.loomloomResultArtifactHead a { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; color: var(--dsw-alias-link); font-size: 12px; line-height: 18px; text-decoration: none; }
.loomloomResultArtifactHead a:hover { text-decoration: underline; }
.loomloomResultTableWrap { max-height: 320px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); scrollbar-width: thin; scrollbar-color: var(--dsw-alias-label-tertiary) transparent; }
.loomloomResultTableWrap::-webkit-scrollbar { width: 8px; height: 8px; }
.loomloomResultTableWrap::-webkit-scrollbar-thumb { border-radius: 4px; background: var(--dsw-alias-label-tertiary); }
.loomloomResultTableWrap::-webkit-scrollbar-track { background: transparent; }
.loomloomResultTable { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 18px; }
.loomloomResultTable th, .loomloomResultTable td { max-width: 320px; padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; }
.loomloomResultTable th { position: sticky; top: 0; z-index: 1; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-weight: 600; white-space: nowrap; }
.loomloomResultTable tr:last-child td { border-bottom: 0; }
.loomloomResultTable td { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.loomloomResultNote { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomResultHead .loomloomIconButton { margin-left: auto; }

@media (max-width: 900px) {
  .loomloomMarketHeader { padding: 20px 0 14px; }
  .loomloomMarketHeaderInner, .loomloomMarketBody { width: calc(100% - 48px); }
}
@media (max-width: 680px) {
  .loomloomHeader { align-items: stretch; flex-direction: column; }
  .loomloomGrid { grid-template-columns: 1fr; }
  .loomloomMarketCards { grid-template-columns: 1fr; }
}
`;
		function installLoomloomStyles() {
			let style = document.getElementById(STYLE_ID);
			if (style === null) {
				style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = css;
				document.head.append(style);
			}
			return () => {
				style?.remove();
			};
		}
		//#endregion
		//#region src/market/client/index.ts
		const NS = "loomloom";
		function apply$1(ctx) {
			const sessions = ctx.get("sessions");
			/**
			* Which workspace a session sits in — the key the sidebar groups by.
			*
			* A session row does not carry it, so it comes from the workspace list: the entry
			* whose membership contains the session. Read at click time rather than at apply
			* time on purpose — `ctx.get` is strict about the provider fiber being settled,
			* and reading it during composition is what silently downgraded the storefront
			* cache to memory-only. A composition without the workspace controller yields no
			* group, and the caller falls back to the host default.
			*/
			const workspaceOf = (sessionId) => {
				const workspaces = ctx.get("workspaces");
				if (workspaces === void 0) return void 0;
				return workspaces.list.getSnapshot().items.find((item) => item.sessionIds.includes(sessionId))?.workspaceId;
			};
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "loomloom: dictionaries");
			ctx.effect(() => installLoomloomStyles(), "loomloom: styles");
			ctx.effect(() => {
				setLoomloomMarketActive(false);
				return () => {
					setLoomloomMarketActive(false);
				};
			}, "loomloom: navigation state");
			ctx.effect(() => installLoomloomSessionNavigationBridge(), "loomloom: session navigation bridge");
			ctx.effect(() => {
				let current = sessions.list.getSnapshot().current;
				return sessions.list.subscribe(() => {
					const next = sessions.list.getSnapshot().current;
					if (next === current) return;
					current = next;
					setLoomloomMarketActive(false);
				});
			}, "loomloom: session selection navigation");
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "loomloom",
				order: 30,
				label: () => ctx.locale.bind(NS)("tab"),
				locale: NS
			}, LoomloomSettingsTab));
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "loomloom-identity",
				order: 0,
				locale: NS
			}, LoomloomIdentityAction));
			ctx.slots.inject("sidebar.primary.navigation", () => ctx.slots.register({
				name: "sidebar.primary.navigation",
				id: "loomloom-market",
				order: 0,
				locale: NS
			}, LoomloomSidebarNavigation));
			ctx.slots.inject("main.surface", () => {
				const MainSurface = ({ defaultContent }) => {
					return useLoomloomMarketActive() ? (0, react.createElement)(LoomloomMarketPage, {
						t: ctx.locale.bind(NS),
						sessions,
						workspaceOf
					}) : defaultContent;
				};
				return ctx.slots.register({
					name: "main.surface",
					locale: NS
				}, MainSurface);
			});
			for (const key of ["loomloom_get_run_results", "loomloom_execute_skillbot"]) ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key,
				locale: NS
			}, LoomloomRunResultCard));
			ctx.slots.inject("settings.onboarding", () => {
				const Onboarding = (props) => (0, react.createElement)(LoomloomOnboarding, {
					...props,
					onCreateFirstChat: () => {
						props.complete();
						sessions.clear();
					}
				});
				return ctx.slots.register({
					name: "settings.onboarding",
					id: "loomloom-connect",
					order: -50,
					label: () => ctx.locale.bind(NS)("connectionTitle"),
					locale: NS
				}, Onboarding);
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"locale",
			"sessions"
		];
		function apply(ctx) {
			ctx.effect(() => installStyles(), "shengsuanyun: styles");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "shengsuanyun",
				order: 25,
				label: "胜算云"
			}, ShengsuanyunSettings));
			apply$1(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map