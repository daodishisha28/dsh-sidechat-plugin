const STYLE_ID = 'dsh-sidechat-plugin-styles'

export function installStyles(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => undefined
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .dsh-sidechat-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .dsh-sidechat-button{border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit;border-radius:6px;padding:4px 8px;cursor:pointer;font:inherit}
    .dsh-sidechat-button:hover{background:rgba(255,255,255,.08)}
    .dsh-sidechat-button:disabled{opacity:.45;cursor:not-allowed}
    .dsh-sidechat-badge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 10px;background:rgba(103,158,254,.14);color:var(--dsw-alias-button-info-fill,rgb(103,158,254));font-size:12px;font-weight:650}
    .dsh-sidechat-parent-label{font-size:12px;opacity:.8}
    .dsh-sidechat-message{font-size:12px;color:#4ade80}
    .dsh-sidechat-command-hint{font-size:12px;opacity:.7;margin:0 0 12px}
    .dsh-sidechat-view{padding:18px;overflow:auto;height:100%;box-sizing:border-box}
    .dsh-sidechat-view h2{margin:0 0 14px;font-size:18px}
    .dsh-sidechat-list{display:grid;gap:10px}
    .dsh-sidechat-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;position:relative;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));transition:border-color .15s,background .15s}
    .dsh-sidechat-card:hover{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,rgb(44,44,46))}
    .dsh-sidechat-card[data-depth]:not([data-depth="0"])::before{content:"";position:absolute;left:-18px;top:-12px;bottom:50%;width:14px;border-left:1.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-bottom:1.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-bottom-left-radius:8px}
    .dsh-sidechat-title{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-sidechat-tree-toggle{display:inline-grid;place-items:center;width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;padding:0;font:13px/1 inherit}
    .dsh-sidechat-tree-toggle:hover{background:rgba(255,255,255,.08)}
    .dsh-sidechat-tree-leaf{display:inline-grid;place-items:center;width:26px;height:26px;text-align:center;opacity:.5}
    .dsh-sidechat-meta{font-size:12px;color:var(--dsw-alias-label-tertiary,rgb(173,178,184));display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}
    .dsh-sidechat-meta time{color:var(--dsw-alias-label-caption,rgb(129,133,140))}
    .dsh-sidechat-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:10000;padding:20px}
    .dsh-sidechat-dialog{box-sizing:border-box;width:min(760px,100%);max-height:min(860px,calc(100vh - 40px));overflow:auto;background:var(--dsw-alias-bg-layer-2,rgb(44,44,46));color:var(--dsw-alias-label-primary,rgb(249,250,251));border:1px solid var(--dsw-alias-border-inverted,rgba(255,255,255,.06));border-radius:24px;padding:18px;box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.08))}
    .dsh-sidechat-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
    .dsh-sidechat-dialog-header h2{margin:0;font-size:16px;font-weight:500;line-height:24px}
    .dsh-sidechat-dialog-tag{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:999px;background:rgba(103,158,254,.12);color:var(--dsw-alias-button-info-fill,rgb(103,158,254));font-size:12px;font-weight:600;line-height:normal;vertical-align:1px}
    .dsh-sidechat-icon-button{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,rgb(173,178,184));cursor:pointer;font:20px/1 inherit}
    .dsh-sidechat-icon-button:hover{background:rgba(255,255,255,.08);color:var(--dsw-alias-label-primary,rgb(249,250,251))}
    .dsh-sidechat-dialog button:focus-visible{outline:2px solid var(--dsw-alias-button-info-fill,rgb(103,158,254));outline-offset:2px}
    .dsh-sidechat-dialog textarea{width:100%;min-height:310px;resize:vertical;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px;font:13px/1.5 ui-monospace,monospace;outline:none}
    .dsh-sidechat-dialog textarea:not(.dsh-sidechat-question):focus{border-color:var(--dsw-alias-button-info-fill,rgb(103,158,254));box-shadow:0 0 0 3px rgba(103,158,254,.18)}
    .dsh-sidechat-dialog textarea.dsh-sidechat-question{min-height:96px;font:inherit;background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px;outline:none;transition:border-color .15s,box-shadow .15s}
    .dsh-sidechat-dialog textarea.dsh-sidechat-question:focus{border-color:var(--dsw-alias-button-info-fill,rgb(103,158,254));box-shadow:0 0 0 3px rgba(103,158,254,.18)}
    .dsh-sidechat-dialog textarea.dsh-sidechat-question::placeholder{color:var(--dsw-alias-label-caption,rgb(129,133,140))}
    .dsh-sidechat-dialog textarea.dsh-sidechat-compact-textarea{min-height:96px;font:inherit}
    .dsh-sidechat-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
    .dsh-sidechat-dialog-footer{align-items:center;gap:10px;margin-top:10px;padding:16px 6px 2px}
    .dsh-sidechat-keyboard-hint{margin-right:auto;color:var(--dsw-alias-label-caption,rgb(129,133,140));font-size:11.5px;white-space:nowrap}
    .dsh-sidechat-keyboard-hint kbd{font-family:inherit;font-size:10.5px;background:var(--dsw-alias-bg-layer-3,rgb(53,54,56));border:1px solid rgba(255,255,255,.12);border-bottom-width:2px;border-radius:5px;padding:1px 5px}
    .dsh-sidechat-button-primary,.dsh-sidechat-button-secondary{height:36px;padding:0 16px;border-radius:18px;font-weight:600}
    .dsh-sidechat-button-primary{border:0;background:var(--dsw-alias-button-primary-fill,rgb(249,250,251));color:var(--dsw-alias-label-primary-foreground,rgb(15,17,21))}
    .dsh-sidechat-button-primary:hover{filter:brightness(.92)}
    .dsh-sidechat-button-secondary{border:1px solid rgba(255,255,255,.12);background:transparent;color:var(--dsw-alias-label-secondary,rgb(207,211,214))}
    .dsh-sidechat-button-secondary:hover{background:rgba(255,255,255,.08);color:var(--dsw-alias-label-primary,rgb(249,250,251))}
    .dsh-sidechat-workflow{width:min(800px,100%)}
    .dsh-sidechat-workflow.dsh-sidechat-dialog-narrow{width:min(440px,100%)}
    .dsh-sidechat-field{display:grid;gap:6px;font-size:13px;margin:10px 0}
    .dsh-sidechat-field>span{font-weight:600}
    .dsh-sidechat-field input,.dsh-sidechat-field select{box-sizing:border-box;min-height:36px;width:100%;border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:6px 9px;background:transparent;color:inherit;font:inherit}
    .dsh-sidechat-range-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .dsh-sidechat-choice-list{display:grid;gap:7px;max-height:270px;overflow:auto;margin:12px 0;padding:2px}
    .dsh-sidechat-choice{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:10px;align-items:start;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));border-radius:10px;cursor:pointer;background:var(--dsw-alias-bg-layer-1,rgb(35,35,36))}
    .dsh-sidechat-choice:has(input:checked){border-color:rgba(103,158,254,.55);background:rgba(103,158,254,.09)}
    .dsh-sidechat-choice input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
    .dsh-sidechat-choice input:focus-visible~.dsh-sidechat-radio{outline:2px solid var(--dsw-alias-button-info-fill,rgb(103,158,254));outline-offset:2px}
    .dsh-sidechat-radio{width:16px;height:16px;margin-top:2px;border:1.5px solid rgba(255,255,255,.16);border-radius:50%;display:grid;place-items:center;flex:none}
    .dsh-sidechat-choice:has(input:checked) .dsh-sidechat-radio,.dsh-sidechat-strategy-option.is-active .dsh-sidechat-radio{border-color:var(--dsw-alias-button-info-fill,rgb(103,158,254))}
    .dsh-sidechat-choice:has(input:checked) .dsh-sidechat-radio::after,.dsh-sidechat-strategy-option.is-active .dsh-sidechat-radio::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-button-info-fill,rgb(103,158,254))}
    .dsh-sidechat-choice span{display:grid;gap:2px;min-width:0}
    .dsh-sidechat-choice small{color:var(--dsw-alias-label-tertiary,rgb(173,178,184));line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .dsh-sidechat-strategy-list{display:grid;gap:6px;margin:12px 0;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));outline:none}
    .dsh-sidechat-strategy-list:focus-visible{box-shadow:0 0 0 2px rgba(103,158,254,.7)}
    .dsh-sidechat-strategy-option{display:grid;grid-template-columns:auto minmax(150px,.42fr) minmax(0,1fr);gap:12px;align-items:center;width:100%;border:0;border-radius:8px;padding:12px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
    .dsh-sidechat-strategy-option small{color:var(--dsw-alias-label-tertiary,rgb(173,178,184));line-height:1.45;font-size:12px}
    .dsh-sidechat-strategy-option.is-active{background:rgba(103,158,254,.14);box-shadow:inset 0 0 0 1px rgba(103,158,254,.55)}
    .dsh-sidechat-rec{font-size:10.5px;font-weight:600;color:var(--dsw-alias-button-info-fill,rgb(103,158,254));background:rgba(103,158,254,.14);border-radius:5px;padding:1px 6px;margin-left:6px;vertical-align:1px}
    .dsh-sidechat-inline-options{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
    .dsh-sidechat-steps{display:flex;align-items:center;gap:8px;margin:6px 0 18px;color:var(--dsw-alias-label-caption,rgb(129,133,140));font-size:12px}
    .dsh-sidechat-step{display:flex;align-items:center;gap:6px;white-space:nowrap}
    .dsh-sidechat-step-dot{width:18px;height:18px;border:1px solid rgba(255,255,255,.16);border-radius:50%;display:grid;place-items:center;font-size:11px}
    .dsh-sidechat-step-done .dsh-sidechat-step-dot{border-color:var(--dsw-alias-button-info-fill,rgb(103,158,254));background:var(--dsw-alias-button-info-fill,rgb(103,158,254));color:var(--dsw-alias-label-primary-foreground,rgb(15,17,21));font-weight:700}
    .dsh-sidechat-step-current{color:var(--dsw-alias-label-primary,rgb(249,250,251));font-weight:600}
    .dsh-sidechat-step-current .dsh-sidechat-step-dot{border-color:var(--dsw-alias-button-info-fill,rgb(103,158,254));color:var(--dsw-alias-button-info-fill,rgb(103,158,254))}
    .dsh-sidechat-step-line{flex:0 0 24px;height:1px;background:rgba(255,255,255,.12)}
    .dsh-sidechat-seed-preview{margin:12px 0 6px;padding:14px 16px;border:1px solid var(--dsw-alias-border-inverted,rgba(255,255,255,.06));border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgb(35,35,36))}
    .dsh-sidechat-seed-scroll{max-height:min(320px,36vh);overflow-y:auto;overscroll-behavior:contain;padding-right:4px}
    .dsh-sidechat-seed-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
    .dsh-sidechat-seed-header h3{margin:0;color:var(--dsw-alias-label-secondary,rgb(207,211,214));font-size:13px;font-weight:600}
    .dsh-sidechat-seed-token{padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgb(53,54,56));color:var(--dsw-alias-label-tertiary,rgb(173,178,184));font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .dsh-sidechat-seed-bubble{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;margin-top:7px;padding:10px 12px;border:1px solid var(--dsw-alias-border-inverted,rgba(255,255,255,.06));border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgb(44,44,46))}
    .dsh-sidechat-seed-role{width:20px;height:20px;margin-top:1px;border-radius:6px;background:rgba(103,158,254,.16);color:var(--dsw-alias-button-info-fill,rgb(103,158,254));display:grid;place-items:center;font-size:10px;font-weight:700}
    .dsh-sidechat-choice .dsh-sidechat-seed-role{margin-top:1px}
    .dsh-sidechat-seed-message{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;color:var(--dsw-alias-label-tertiary,rgb(173,178,184));font-size:12.5px;line-height:1.55}
    .dsh-sidechat-seed-scroll .dsh-sidechat-seed-message{display:block;overflow:visible;-webkit-line-clamp:unset;white-space:pre-wrap;overflow-wrap:anywhere}
    .dsh-sidechat-seed-message strong{color:var(--dsw-alias-label-secondary,rgb(207,211,214));font-weight:600}
    .dsh-sidechat-seed-preview>p{margin:5px 0;color:var(--dsw-alias-label-tertiary,rgb(173,178,184));font-size:12px}
    .dsh-sidechat-freeze-note{display:flex;align-items:center;gap:8px;margin-top:10px;color:var(--dsw-alias-label-caption,rgb(129,133,140));font-size:11.5px}
    .dsh-sidechat-muted{opacity:.68;font-size:12px}
    .dsh-sidechat-notice{padding:10px 12px;border-radius:10px;background:rgba(74,222,128,.12);border-left:3px solid #4ade80;color:var(--dsw-alias-label-secondary,rgb(207,211,214));font-size:12.5px;line-height:1.55}
    .dsh-sidechat-notice-warning{background:rgba(251,191,36,.1);border-left-color:#fbbf24}
    .dsh-sidechat-notice-error{background:rgba(248,113,113,.1);border-left-color:#f87171}
    .dsh-sidechat-notice-bar{display:flex;gap:10px;padding:10px 12px;border-radius:10px;background:rgba(251,191,36,.1);border-left:3px solid #fbbf24;color:var(--dsw-alias-label-secondary,rgb(207,211,214));font-size:12.5px;line-height:1.55}
    .dsh-sidechat-notice-bar::before{content:"⚠";flex:none;color:#fbbf24;font-size:14px;line-height:1.5}
    .dsh-sidechat-button-danger{height:36px;padding:0 16px;border-radius:18px;color:#f87171;border:1px solid rgba(248,113,113,.45);background:transparent;font-weight:600}
    .dsh-sidechat-button-danger:hover{background:rgba(248,113,113,.12)}
    .dsh-sidechat-button-warning{height:36px;padding:0 16px;border-radius:18px;color:#fbbf24;border:1px solid rgba(251,191,36,.45);background:transparent;font-weight:600}
    .dsh-sidechat-button-warning:hover{background:rgba(251,191,36,.1)}
    .dsh-sidechat-error{color:#f87171;font-size:12px;margin-top:6px}
    .dsh-sidechat-revisions{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:11px}
    .dsh-sidechat-revision{border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 7px;display:inline-flex;align-items:center;gap:6px}
    .dsh-sidechat-revision button{border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;padding:0;font:inherit}
    .dsh-sidechat-revision-withdrawn{opacity:.55;text-decoration:line-through}
    .dsh-sidechat-diff{white-space:pre-wrap;max-height:55vh;overflow:auto;padding:0;border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));font:12.5px/1.7 ui-monospace,monospace}
    .dsh-sidechat-diff>span{display:block;padding:0 12px;border-left:3px solid transparent;white-space:pre-wrap}
    .dsh-sidechat-diff-added{background:rgba(74,222,128,.1);border-left-color:#4ade80!important}
    .dsh-sidechat-diff-removed{background:rgba(248,113,113,.1);border-left-color:#f87171!important}
    .dsh-sidechat-diff-added .dsh-sidechat-diff-prefix{color:#4ade80}
    .dsh-sidechat-diff-removed .dsh-sidechat-diff-prefix{color:#f87171}
    .dsh-sidechat-diff-same{color:var(--dsw-alias-label-tertiary,rgb(173,178,184))}
    .dsh-sidechat-diff-prefix{display:inline-block;width:16px;color:var(--dsw-alias-label-tertiary,rgb(173,178,184))}
    .dsh-sidechat-parent-label{color:var(--dsw-alias-label-tertiary,rgb(173,178,184));text-decoration:none;text-underline-offset:2px}
    .dsh-sidechat-parent-label:hover{color:var(--dsw-alias-button-info-fill,rgb(103,158,254))}
    .dsh-sidechat-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11.5px;background:var(--dsw-alias-bg-layer-3,rgb(53,54,56));color:var(--dsw-alias-label-tertiary,rgb(173,178,184));font-variant-numeric:tabular-nums;white-space:nowrap}
    .dsh-sidechat-chip-ok{background:rgba(74,222,128,.12);color:#4ade80}
    .dsh-sidechat-chip-warn{background:rgba(251,191,36,.12);color:#fbbf24}
    .dsh-sidechat-chip-err{background:rgba(248,113,113,.12);color:#f87171}
    .dsh-sidechat-status{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary,rgb(173,178,184))}
    .dsh-sidechat-status-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none}
    .dsh-sidechat-status-dot-open{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,.6)}
    .dsh-sidechat-status-dot-orphaned{background:#fbbf24;box-shadow:0 0 6px rgba(251,191,36,.5)}
    .dsh-sidechat-status-dot-abandoned{background:#f87171}
    .dsh-sidechat-status-dot-archived{background:var(--dsw-alias-label-caption,rgb(129,133,140))}
    .dsh-sidechat-status-dot-unknown{background:var(--dsw-alias-label-caption,rgb(129,133,140))}
    .dsh-sidechat-meta .dsh-sidechat-chip{font-size:11.5px}
    .dsh-sidechat-meta .dsh-sidechat-status{font-size:12px}
    .dsh-sidechat-separator{width:1px;height:14px;background:rgba(255,255,255,.12)}
    .dsh-sidechat-meta-row{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
    .dsh-sidechat-fold-editor{min-height:310px!important}
    .dsh-sidechat-button-open{height:28px;padding:0 12px;border-radius:14px;font-size:12.5px}
    .dsh-sidechat-empty{text-align:center;color:var(--dsw-alias-label-caption,rgb(129,133,140));padding:24px 0}
    .dsh-sidechat-usage-grid{display:grid;gap:10px}
    .dsh-sidechat-ucard{background:var(--dsw-alias-bg-layer-1,rgb(35,35,36));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));border-radius:12px;padding:14px 16px;margin-top:10px}
    .dsh-sidechat-ucard h3{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary,rgb(207,211,214));margin:0 0 10px}
    .dsh-sidechat-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
    .dsh-sidechat-stat-tile{background:var(--dsw-alias-bg-layer-2,rgb(44,44,46));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));border-radius:10px;padding:8px 12px}
    .dsh-sidechat-stat-tile dt{font-size:11px;color:var(--dsw-alias-label-caption,rgb(129,133,140))}
    .dsh-sidechat-stat-tile dd{margin:2px 0 0;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
    .dsh-sidechat-stat-na{color:var(--dsw-alias-label-caption,rgb(129,133,140));font-weight:500!important}
    .dsh-sidechat-skeleton{height:56px;border-radius:10px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1,rgb(35,35,36)) 25%,var(--dsw-alias-bg-layer-2,rgb(44,44,46)) 50%,var(--dsw-alias-bg-layer-1,rgb(35,35,36)) 75%);background-size:200% 100%;animation:dsh-sidechat-shimmer 1.4s infinite}
    @keyframes dsh-sidechat-shimmer{to{background-position:-200% 0}}
    .dsh-sidechat-notification-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:20px;margin:6px auto 10px}
    .dsh-sidechat-notification-icon-success{background:rgba(74,222,128,.14);color:#4ade80}
    .dsh-sidechat-notification-icon-warning{background:rgba(251,191,36,.14);color:#fbbf24}
    .dsh-sidechat-notification-icon-error{background:rgba(248,113,113,.14);color:#f87171}
    .dsh-sidechat-notification-message{text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary,rgb(207,211,214));line-height:1.6;padding:0 8px}
    @media (max-width:520px){
      .dsh-sidechat-dialog{padding:16px}
       .dsh-sidechat-steps{gap:6px;font-size:11px}
       .dsh-sidechat-step-line{flex-basis:12px}
       .dsh-sidechat-strategy-option{grid-template-columns:auto minmax(0,1fr);gap:10px}
       .dsh-sidechat-strategy-option small{grid-column:2}
       .dsh-sidechat-dialog-footer{flex-wrap:wrap;padding-inline:0}
      .dsh-sidechat-keyboard-hint{flex:1 1 100%;margin-right:0;white-space:normal}
    }
  `
  document.head.append(style)
  return () => { style.remove() }
}
