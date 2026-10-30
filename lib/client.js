window.__ModuleLoader__.load({
	id: "dsh-plugin-shengsuanyun",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		async function logout() {
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
					await logout();
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
		const STYLE_ID = "dsh-plugin-shengsuanyun/styles";
		const css = `
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
			if (document.getElementById(STYLE_ID) !== null) return () => {};
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = css;
			document.head.append(style);
			return () => {
				style.remove();
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		function apply(ctx) {
			ctx.effect(() => installStyles(), "shengsuanyun: styles");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "shengsuanyun",
				order: 25,
				label: "胜算云"
			}, ShengsuanyunSettings));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map