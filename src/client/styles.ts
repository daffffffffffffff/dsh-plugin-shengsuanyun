const STYLE_ID = 'dsh-plugin-shengsuanyun/styles'

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
`

export function installStyles(): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.append(style)
  return () => { style.remove() }
}
