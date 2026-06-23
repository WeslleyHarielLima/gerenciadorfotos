"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClient } from "@/lib/api";
import { dashboardPathForRole } from "@/lib/auth";

type BtnState = "idle" | "loading" | "error";

/* ── SVG inline helpers ─────────────────────────────────── */
function IcoUser() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function IcoLock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  );
}

function IcoEyeOn() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function IcoEyeOff() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function IcoEnter() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
      <polyline points="10 17 15 12 10 7"/>
      <line x1="15" y1="12" x2="3" y2="12"/>
    </svg>
  );
}

function IcoAlert() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8v4M12 16h.01"/>
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

/* ── Componente principal ─────────────────────────────── */
export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [btnState, setBtnState] = useState<BtnState>("idle");
  const [globalError, setGlobalError] = useState("");
  const [userErr, setUserErr] = useState(false);
  const [passErr, setPassErr] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setUserErr(false);
    setPassErr(false);
    setGlobalError("");

    let valid = true;
    if (!username) { setUserErr(true); valid = false; }
    if (!password) { setPassErr(true); valid = false; }
    if (!valid) return;

    setBtnState("loading");
    try {
      const data = await ApiClient.login(username, password);
      router.push(dashboardPathForRole(data.user.role));
    } catch (err: unknown) {
      setGlobalError(
        err instanceof Error ? err.message : "Credenciais inválidas. Verifique e tente novamente."
      );
      setBtnState("error");
      setTimeout(() => { setBtnState("idle"); setGlobalError(""); }, 3000);
    }
  }

  /* ── styles helpers ─ */
  const S = {
    page: {
      display: "flex",
      alignItems: "stretch",
      position: "relative",
    } as React.CSSProperties,

    bg: {
      position: "absolute",
      inset: 0,
      zIndex: 0,
      overflow: "hidden",
      background: "#050c18",
    } as React.CSSProperties,

    bgImg: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "center 20%",
      filter: "brightness(0.5) saturate(0.8)",
    } as React.CSSProperties,

    overlayLeft: {
      position: "absolute",
      inset: 0,
      background: "var(--overlay-left)",
    } as React.CSSProperties,

    overlayBottom: {
      position: "absolute",
      inset: 0,
      background: "var(--overlay-bottom)",
    } as React.CSSProperties,

    glowBlue: {
      position: "absolute",
      top: "-20%",
      left: "-10%",
      width: "50%",
      height: "50%",
      borderRadius: "50%",
      background: "rgba(47,116,255,0.14)",
      filter: "blur(120px)",
      pointerEvents: "none",
    } as React.CSSProperties,

    glowGold: {
      position: "absolute",
      bottom: "-15%",
      right: "5%",
      width: "35%",
      height: "35%",
      borderRadius: "50%",
      background: "rgba(242,194,48,0.09)",
      filter: "blur(100px)",
      pointerEvents: "none",
    } as React.CSSProperties,

    divider: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      zIndex: 50,
      background: "linear-gradient(90deg,#2f74ff 0%,#f2c230 50%,#2f74ff 100%)",
      boxShadow: "0 0 10px rgba(47,116,255,0.45)",
    } as React.CSSProperties,

    colLeft: {
      flex: 1,
      minWidth: 0,
      position: "relative",
      zIndex: 10,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      padding: "60px 0 60px 7%",
    } as React.CSSProperties,

    candName: {
      fontSize: "clamp(32px,5vw,76px)",
      fontWeight: 900,
      lineHeight: 0.92,
      letterSpacing: "-0.02em",
      color: "#fff",
      textTransform: "uppercase",
      textShadow: "0 3px 24px rgba(0,0,0,0.7)",
    } as React.CSSProperties,

    ribbon: {
      marginTop: 14,
      display: "flex",
      height: 6,
      width: "clamp(160px,20vw,260px)",
    } as React.CSSProperties,

    candTag: {
      marginTop: 14,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: "rgba(255,255,255,0.38)",
    } as React.CSSProperties,

    colRight: {
      width: 400,
      flexShrink: 0,
      position: "relative",
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px 24px",
    } as React.CSSProperties,

    card: {
      width: "100%",
      background: "var(--bg-card)",
      border: "1px solid var(--border-default)",
      borderRadius: 20,
      padding: "30px 28px 24px",
      boxShadow: "0 12px 48px rgba(0,0,0,0.55),0 2px 8px rgba(0,0,0,0.35)",
      position: "relative",
      overflow: "hidden",
    } as React.CSSProperties,

    cardTopLine: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)",
    } as React.CSSProperties,

    cardLogo: {
      width: 44,
      height: 44,
      borderRadius: 11,
      background: "linear-gradient(135deg,var(--brand-primary) 0%,var(--brand-secondary) 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 19,
      fontWeight: 900,
      color: "var(--text-on-brand)",
      marginBottom: 16,
      boxShadow: "0 4px 14px rgba(47,116,255,0.28)",
    } as React.CSSProperties,

    cardTitle: {
      fontSize: 19,
      fontWeight: 800,
      color: "var(--text-primary)",
      lineHeight: 1.1,
      marginBottom: 3,
    } as React.CSSProperties,

    cardSub: {
      fontSize: 11,
      color: "var(--text-muted)",
      letterSpacing: "0.04em",
      marginBottom: 22,
      display: "flex",
      alignItems: "center",
      gap: 8,
    } as React.CSSProperties,

    fieldGroup: {
      marginBottom: 14,
    } as React.CSSProperties,

    fieldLabel: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.10em",
      textTransform: "uppercase",
      color: "var(--text-muted)",
      marginBottom: 5,
    } as React.CSSProperties,

    fieldIcon: {
      width: 42,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      color: "var(--text-muted)",
    } as React.CSSProperties,

    fieldInput: {
      flex: 1,
      background: "none",
      border: "none",
      outline: "none",
      color: "var(--text-primary)",
      fontSize: 13,
      fontFamily: "inherit",
      padding: "0 8px 0 0",
    } as React.CSSProperties,

    toggleBtn: {
      width: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      background: "none",
      border: "none",
      cursor: "pointer",
      color: "var(--text-muted)",
    } as React.CSSProperties,

    fieldErr: {
      fontSize: 11,
      color: "var(--state-danger)",
      marginTop: 4,
      display: "flex",
      alignItems: "center",
      gap: 4,
    } as React.CSSProperties,

    forgotLink: {
      color: "var(--brand-primary)",
      textDecoration: "none",
      fontSize: 10,
      fontWeight: 600,
    } as React.CSSProperties,

    globalErr: {
      textAlign: "center",
      fontSize: 12,
      color: "var(--state-danger)",
      marginBottom: 12,
      padding: "9px 12px",
      borderRadius: 8,
      background: "rgba(232,93,93,0.10)",
      border: "1px solid rgba(232,93,93,0.22)",
    } as React.CSSProperties,

    submitBtn: {
      width: "100%",
      height: 46,
      borderRadius: 9,
      border: "none",
      background: "var(--brand-secondary)",
      color: "#fff",
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: "0.07em",
      fontFamily: "inherit",
      textTransform: "uppercase",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      boxShadow: "0 4px 18px rgba(47,116,255,0.38)",
      marginTop: 6,
      marginBottom: 18,
      cursor: "pointer",
    } as React.CSSProperties,

    dividerOr: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      margin: "4px 0 12px",
    } as React.CSSProperties,

    dividerLine: {
      flex: 1,
      height: 1,
      background: "var(--border-default)",
    } as React.CSSProperties,

    googleBtn: {
      width: "100%",
      height: 44,
      borderRadius: 9,
      cursor: "pointer",
      background: "transparent",
      border: "1px solid var(--border-default)",
      color: "var(--text-secondary)",
      fontSize: 13,
      fontWeight: 600,
      fontFamily: "inherit",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      marginBottom: 4,
    } as React.CSSProperties,

    notice: {
      textAlign: "center",
      fontSize: 11,
      color: "var(--text-muted)",
      lineHeight: 1.6,
      borderTop: "1px solid var(--border-default)",
      paddingTop: 14,
    } as React.CSSProperties,

    footer: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      padding: "12px 40px",
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 10,
      color: "rgba(202,212,227,0.28)",
      letterSpacing: "0.07em",
    } as React.CSSProperties,
  };

  return (
    <div className="login-page" style={S.page}>

      {/* Fundo */}
      <div style={S.bg}>
        {/* Coloque /public/banner-campanha.png para exibir a foto de campanha */}
        <img src="/banner-campanha.png" alt="" style={S.bgImg} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}/>
        <div style={S.overlayLeft} />
        <div style={S.overlayBottom} />
        <div style={S.glowBlue} />
        <div style={S.glowGold} />
      </div>

      {/* Barra de marca no topo */}
      <div style={S.divider} />

      {/* Coluna esquerda — identidade do candidato */}
      <div className="login-identity">
        <div style={S.candName}>
          <span style={{ display: "block" }}>Wiveslando</span>
          <span style={{ display: "block" }}>Neiva</span>
        </div>
        <div style={S.ribbon}>
          <div style={{ flex: 1.6, background: "#2f74ff", borderRadius: "3px 0 0 3px" }} />
          <div style={{ flex: 1, background: "#f2c230" }} />
          <div style={{ flex: 0.5, background: "#2f74ff", borderRadius: "0 3px 3px 0" }} />
        </div>
        <div style={S.candTag}>Campanha 2026 · Campos dos Goytacazes</div>
      </div>

      {/* Coluna direita — card de login */}
      <div className="login-card-col">
        <div style={S.card}>
          <div style={S.cardTopLine} />

          <div style={S.cardLogo}>W</div>
          <div style={S.cardTitle}>Plataforma Operacional</div>
          <div style={S.cardSub}>
            Campanha 2026
            <div style={{ flex: 1, height: 1, background: "linear-gradient(to right,var(--brand-primary),transparent)" }} />
          </div>

          <form onSubmit={handleSubmit} noValidate>

            {/* Campo — Identificador */}
            <div style={S.fieldGroup}>
              <div style={S.fieldLabel}>Usuário</div>
              <div className={`ds-input-wrap${userErr ? " ds-error" : ""}`}>
                <div style={S.fieldIcon}><IcoUser /></div>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="ex: uploader1"
                  autoComplete="username"
                  required
                  style={S.fieldInput}
                />
              </div>
              {userErr && (
                <div style={S.fieldErr}>
                  <IcoAlert /> Informe seu usuário
                </div>
              )}
            </div>

            {/* Campo — Senha */}
            <div style={S.fieldGroup}>
              <div style={S.fieldLabel}>
                Senha
                <a href="#" onClick={e => e.preventDefault()} style={S.forgotLink}>
                  Esqueci minha senha
                </a>
              </div>
              <div className={`ds-input-wrap${passErr ? " ds-error" : ""}`}>
                <div style={S.fieldIcon}><IcoLock /></div>
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  style={{ ...S.fieldInput, padding: "0" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  style={S.toggleBtn}
                  aria-label={showPass ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPass ? <IcoEyeOff /> : <IcoEyeOn />}
                </button>
              </div>
              {passErr && (
                <div style={S.fieldErr}>
                  <IcoAlert /> Informe sua senha
                </div>
              )}
            </div>

            {/* Erro global */}
            {globalError && <div style={S.globalErr}>{globalError}</div>}

            {/* Botão de submit */}
            <button
              type="submit"
              disabled={btnState === "loading"}
              style={{
                ...S.submitBtn,
                opacity: btnState === "loading" ? 0.55 : 1,
                cursor: btnState === "loading" ? "default" : "pointer",
              }}
            >
              {btnState === "loading" ? (
                <>
                  <span className="ds-spinner" />
                  Verificando…
                </>
              ) : (
                <>
                  <IcoEnter />
                  {btnState === "error" ? "Tentar novamente" : "Entrar na plataforma"}
                </>
              )}
            </button>

            {/* Separador */}
            <div style={S.dividerOr}>
              <div style={S.dividerLine} />
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>ou</span>
              <div style={S.dividerLine} />
            </div>

            {/* Botão Google */}
            <button type="button" style={S.googleBtn}>
              <GoogleLogo />
              Entrar com Google
            </button>

          </form>

          <div style={S.notice}>
            <strong style={{ color: "var(--text-secondary)" }}>Acesso restrito a pessoal autorizado.</strong><br />
            Todas as atividades são registradas na trilha de auditoria.
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <div className="login-footer" style={S.footer}>
        <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
          Wiveslando Neiva · Campanha 2026
        </div>
        <div style={{ display: "flex", gap: 20, fontWeight: 500 }}>
          <span>Plataforma Operacional</span>
          <span>Política de privacidade</span>
          <span>© 2026</span>
        </div>
      </div>

    </div>
  );
}
