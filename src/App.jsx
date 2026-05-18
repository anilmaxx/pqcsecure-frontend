import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

// Helper function to safely fetch and parse JSON
async function safeJsonResponse(res) {
  const contentType = res.headers.get("content-type");
  
  if (!contentType || !contentType.includes("application/json")) {
    const text = await res.text();
    if (text.startsWith("<")) {
      throw new Error(
        `API returned HTML instead of JSON. Status: ${res.status}. ` +
        `Check that VITE_API_URL is correct: ${API}`
      );
    }
    throw new Error(`Invalid response format. Expected JSON but got: ${text.substring(0, 100)}`);
  }
  
  return res.json();
}

const PHASE_LABELS = [
  { id: 1, label: "Key Generation", icon: "🔑", desc: "ML-KEM-768 keypair generated" },
  { id: 2, label: "Key Encapsulation", icon: "📦", desc: "Shared secret encapsulated" },
  { id: 3, label: "AES-256-GCM Encrypt", icon: "🔒", desc: "Message encrypted + authenticated" },
  { id: 4, label: "Payload Construction", icon: "🧱", desc: "Header + CT + IV + Tag + Msg" },
  { id: 5, label: "LSB Embedding", icon: "🖼️", desc: "Payload hidden in image pixels" },
  { id: 6, label: "Transmission", icon: "📡", desc: "Stego-image transmitted" },
  { id: 7, label: "Extract & Decrypt", icon: "🔓", desc: "Payload extracted, message recovered" },
];

function Badge({ text, color = "cyan" }) {
  const colors = {
    cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    red: "bg-red-500/10 text-red-400 border-red-500/30",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${colors[color]}`}>
      {text}
    </span>
  );
}

function PhaseTracker({ activePhase }) {
  return (
    <div className="flex flex-col gap-1">
      {PHASE_LABELS.map((p) => (
        <div
          key={p.id}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-300 ${
            activePhase >= p.id
              ? "bg-cyan-500/10 border border-cyan-500/20"
              : "opacity-30"
          }`}
        >
          <span className="text-lg">{p.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-white/90">
              Phase {p.id}: {p.label}
            </div>
            <div className="text-xs text-white/40 truncate">{p.desc}</div>
          </div>
          {activePhase > p.id && (
            <span className="text-emerald-400 text-xs">✓</span>
          )}
          {activePhase === p.id && (
            <span className="text-cyan-400 text-xs animate-pulse">●</span>
          )}
        </div>
      ))}
    </div>
  );
}

function InfoCard({ label, value, mono = true }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
      <div className="text-xs text-white/40 mb-1">{label}</div>
      <div className={`text-xs text-cyan-300 break-all ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [publicKeyInfo, setPublicKeyInfo] = useState(null);
  const [activePhase, setActivePhase] = useState(0);
  const [message, setMessage] = useState("");
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [stegoImage, setStegoImage] = useState(null);
  const [encryptResult, setEncryptResult] = useState(null);
  const [decryptResult, setDecryptResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("encrypt"); // encrypt | decrypt
  const [stegoUpload, setStegoUpload] = useState(null);
  const [stegoSessionId, setStegoSessionId] = useState("");

  const fileRef = useRef();
  const stegoRef = useRef();

  const clearError = () => setError(null);

  // ── Phase 1: Key Generation ──────────────────────────────────────────────
  async function handleKeygen() {
    setLoading(true);
    clearError();
    try {
      setActivePhase(1);
      const res = await fetch(`${API}/keygen`, { method: "POST" });
      const data = await safeJsonResponse(res);
      if (data.error) throw new Error(data.error);
      setSessionId(data.session_id);
      setPublicKeyInfo(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Phases 2-6: Encrypt + Embed ─────────────────────────────────────────
  async function handleEncryptEmbed() {
    if (!sessionId) return setError("Generate keys first (Phase 1).");
    if (!message.trim()) return setError("Enter a message to encrypt.");
    if (!image) return setError("Upload a cover image.");

    setLoading(true);
    clearError();
    try {
      setActivePhase(2);
      const form = new FormData();
      form.append("session_id", sessionId);
      form.append("message", message);
      form.append("image", image);

      const res = await fetch(`${API}/encrypt-embed`, { method: "POST", body: form });
      const data = await safeJsonResponse(res);
      if (data.error) throw new Error(data.error);

      setEncryptResult(data);
      setStegoImage(`data:image/png;base64,${data.stego_image_b64}`);
      setActivePhase(6);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Phase 7: Extract + Decrypt ───────────────────────────────────────────
  async function handleDecrypt() {
    if (!stegoUpload) return setError("Upload the stego image.");
    if (!stegoSessionId.trim()) return setError("Provide the Session ID.");

    setLoading(true);
    clearError();
    setDecryptResult(null);
    try {
      const form = new FormData();
      form.append("session_id", stegoSessionId);
      form.append("stego_image", stegoUpload);

      const res = await fetch(`${API}/extract-decrypt`, { method: "POST", body: form });
      const data = await safeJsonResponse(res);
      if (data.error) throw new Error(data.error);

      setDecryptResult(data);
      setActivePhase(7);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleImageChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setImage(f);
    setImagePreview(URL.createObjectURL(f));
    setStegoImage(null);
    setEncryptResult(null);
    setActivePhase(publicKeyInfo ? 1 : 0);
  }

  function downloadStego() {
    const a = document.createElement("a");
    a.href = stegoImage;
    a.download = "stego_image.png";
    a.click();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050a0f",
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        color: "#e0e8f0",
      }}
    >
      {/* Animated grid bg */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(0,200,220,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,200,220,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
          pointerEvents: "none",
        }}
      />

      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid rgba(0,200,220,0.15)",
          padding: "1.5rem 2rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          background: "rgba(0,15,25,0.8)",
          backdropFilter: "blur(10px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 8,
            background: "linear-gradient(135deg,#00c8dc,#0070b8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          🛡️
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>
            PQ-SECURE TRANSMISSION
          </div>
          <div style={{ fontSize: 11, color: "#00c8dc99", letterSpacing: 2 }}>
            ML-KEM-768 · AES-256-GCM · LSB STEGANOGRAPHY
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["ML-KEM-768", "FIPS 203", "AES-256-GCM", "Post-Quantum"].map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                border: "1px solid rgba(0,200,220,0.3)",
                borderRadius: 4,
                color: "#00c8dc",
                background: "rgba(0,200,220,0.05)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </header>

      <div
        style={{
          maxWidth: 1300,
          margin: "0 auto",
          padding: "2rem",
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: "2rem",
          alignItems: "start",
        }}
      >
        {/* Left: Phase Tracker */}
        <div
          style={{
            background: "rgba(0,15,25,0.7)",
            border: "1px solid rgba(0,200,220,0.15)",
            borderRadius: 12,
            padding: "1.5rem",
            position: "sticky",
            top: 90,
          }}
        >
          <div style={{ fontSize: 11, color: "#00c8dc", letterSpacing: 2, marginBottom: 12 }}>
            METHODOLOGY PHASES
          </div>
          {PHASE_LABELS.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                marginBottom: 4,
                borderRadius: 8,
                transition: "all 0.3s",
                background: activePhase >= p.id ? "rgba(0,200,220,0.07)" : "transparent",
                border: activePhase >= p.id ? "1px solid rgba(0,200,220,0.2)" : "1px solid transparent",
                opacity: activePhase === 0 && p.id > 1 ? 0.3 : activePhase > 0 && activePhase < p.id ? 0.3 : 1,
              }}
            >
              <span style={{ fontSize: 16 }}>{p.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#e0e8f0" }}>
                  Phase {p.id}: {p.label}
                </div>
                <div style={{ fontSize: 9, color: "#ffffff55", marginTop: 1 }}>{p.desc}</div>
              </div>
              {activePhase > p.id && <span style={{ color: "#00dc8c", fontSize: 11 }}>✓</span>}
              {activePhase === p.id && (
                <span style={{ color: "#00c8dc", fontSize: 11, animation: "pulse 1s infinite" }}>●</span>
              )}
            </div>
          ))}

          {/* Session info */}
          {sessionId && (
            <div
              style={{
                marginTop: 16,
                padding: "10px",
                background: "rgba(0,100,60,0.1)",
                border: "1px solid rgba(0,220,140,0.2)",
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 9, color: "#00dc8c", marginBottom: 4 }}>SESSION ACTIVE</div>
              <div style={{ fontSize: 9, fontFamily: "monospace", color: "#00dc8c99", wordBreak: "break-all" }}>
                {sessionId}
              </div>
              <div style={{ fontSize: 9, color: "#ffffff40", marginTop: 4 }}>
                Key size: {publicKeyInfo?.public_key_length} bytes
              </div>
            </div>
          )}
        </div>

        {/* Main Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Error */}
          {error && (
            <div
              style={{
                background: "rgba(220,50,50,0.1)",
                border: "1px solid rgba(220,50,50,0.3)",
                borderRadius: 8,
                padding: "12px 16px",
                color: "#ff7070",
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>⚠ {error}</span>
              <button
                onClick={() => setError(null)}
                style={{ background: "none", border: "none", color: "#ff7070", cursor: "pointer", fontSize: 16 }}
              >
                ×
              </button>
            </div>
          )}

          {/* Phase 1: Key Generation */}
          <div
            style={{
              background: "rgba(0,15,25,0.7)",
              border: "1px solid rgba(0,200,220,0.15)",
              borderRadius: 12,
              padding: "1.5rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#00c8dc" }}>
                  🔑 Phase 1 — Key Generation
                </div>
                <div style={{ fontSize: 11, color: "#ffffff50", marginTop: 2 }}>
                  Generate ML-KEM-768 encapsulation & decapsulation keypair
                </div>
              </div>
              <button
                onClick={handleKeygen}
                disabled={loading}
                style={{
                  padding: "8px 20px",
                  borderRadius: 6,
                  border: "none",
                  background: loading ? "#1a2030" : "linear-gradient(135deg,#00c8dc,#0070b8)",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 12,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}
              >
                {loading && activePhase === 1 ? "GENERATING..." : "GENERATE KEYS"}
              </button>
            </div>

            {publicKeyInfo && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <div
                  style={{
                    background: "rgba(0,200,220,0.05)",
                    border: "1px solid rgba(0,200,220,0.15)",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#00c8dc99", marginBottom: 4 }}>ALGORITHM</div>
                  <div style={{ fontSize: 11, color: "#00c8dc" }}>{publicKeyInfo.algorithm}</div>
                </div>
                <div
                  style={{
                    background: "rgba(0,200,220,0.05)",
                    border: "1px solid rgba(0,200,220,0.15)",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#00c8dc99", marginBottom: 4 }}>SECURITY LEVEL</div>
                  <div style={{ fontSize: 11, color: "#00c8dc" }}>{publicKeyInfo.security_level}</div>
                </div>
                <div
                  style={{
                    background: "rgba(0,200,220,0.05)",
                    border: "1px solid rgba(0,200,220,0.15)",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#00c8dc99", marginBottom: 4 }}>PUBLIC KEY SIZE</div>
                  <div style={{ fontSize: 11, color: "#00c8dc" }}>{publicKeyInfo.public_key_length} bytes</div>
                </div>
                <div
                  style={{
                    background: "rgba(0,200,220,0.05)",
                    border: "1px solid rgba(0,200,220,0.15)",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#00c8dc99", marginBottom: 4 }}>KEYGEN TIME</div>
                  <div style={{ fontSize: 11, color: "#00c8dc" }}>{publicKeyInfo.keygen_time_ms} ms</div>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4 }}>
            {["encrypt", "decrypt"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "8px 24px",
                  border: tab === t ? "1px solid rgba(0,200,220,0.5)" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  background: tab === t ? "rgba(0,200,220,0.1)" : "transparent",
                  color: tab === t ? "#00c8dc" : "#ffffff60",
                  fontFamily: "inherit",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: tab === t ? 700 : 400,
                  letterSpacing: 1,
                }}
              >
                {t === "encrypt" ? "🔒 ENCRYPT & HIDE" : "🔓 EXTRACT & DECRYPT"}
              </button>
            ))}
          </div>

          {tab === "encrypt" ? (
            <>
              {/* Encrypt panel */}
              <div
                style={{
                  background: "rgba(0,15,25,0.7)",
                  border: "1px solid rgba(0,200,220,0.15)",
                  borderRadius: 12,
                  padding: "1.5rem",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "#00c8dc", marginBottom: 16 }}>
                  📝 Message & Cover Image (Phases 2–6)
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {/* Message */}
                  <div>
                    <label style={{ fontSize: 11, color: "#ffffff60", display: "block", marginBottom: 6 }}>
                      SECRET MESSAGE
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Enter your secret message..."
                      rows={6}
                      style={{
                        width: "100%",
                        background: "rgba(0,30,50,0.5)",
                        border: "1px solid rgba(0,200,220,0.2)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        color: "#e0e8f0",
                        fontFamily: "inherit",
                        fontSize: 12,
                        resize: "vertical",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ fontSize: 10, color: "#ffffff30", marginTop: 4 }}>
                      {message.length} characters
                    </div>
                  </div>

                  {/* Image upload */}
                  <div>
                    <label style={{ fontSize: 11, color: "#ffffff60", display: "block", marginBottom: 6 }}>
                      COVER IMAGE
                    </label>
                    <div
                      onClick={() => fileRef.current.click()}
                      style={{
                        border: "2px dashed rgba(0,200,220,0.25)",
                        borderRadius: 8,
                        height: 140,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      {imagePreview ? (
                        <img
                          src={imagePreview}
                          alt="cover"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <div style={{ textAlign: "center", color: "#ffffff40" }}>
                          <div style={{ fontSize: 24 }}>🖼️</div>
                          <div style={{ fontSize: 11, marginTop: 4 }}>Click to upload image</div>
                          <div style={{ fontSize: 9, marginTop: 2 }}>PNG, JPG, BMP supported</div>
                        </div>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleImageChange} style={{ display: "none" }} />
                  </div>
                </div>

                <button
                  onClick={handleEncryptEmbed}
                  disabled={loading || !sessionId}
                  style={{
                    marginTop: 16,
                    width: "100%",
                    padding: "12px",
                    borderRadius: 8,
                    border: "none",
                    background:
                      !sessionId
                        ? "#1a2030"
                        : loading
                        ? "#0d2040"
                        : "linear-gradient(135deg,#006080,#00a0c0)",
                    color: !sessionId ? "#ffffff30" : "#fff",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: !sessionId || loading ? "not-allowed" : "pointer",
                    letterSpacing: 2,
                  }}
                >
                  {loading ? "⏳ PROCESSING..." : "🔒 ENCRYPT + EMBED INTO IMAGE"}
                </button>

                {!sessionId && (
                  <div style={{ textAlign: "center", fontSize: 10, color: "#ff8c00", marginTop: 8 }}>
                    ↑ Generate keys first (Phase 1)
                  </div>
                )}
              </div>

              {/* Stego result */}
              {stegoImage && encryptResult && (
                <div
                  style={{
                    background: "rgba(0,15,25,0.7)",
                    border: "1px solid rgba(0,220,140,0.2)",
                    borderRadius: 12,
                    padding: "1.5rem",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#00dc8c", marginBottom: 16 }}>
                    ✅ Stego Image Ready — Phase 6: Transmission
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#ffffff60", marginBottom: 8 }}>STEGO IMAGE (looks normal!)</div>
                      <img
                        src={stegoImage}
                        alt="stego"
                        style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(0,220,140,0.2)" }}
                      />
                      <button
                        onClick={downloadStego}
                        style={{
                          marginTop: 10,
                          width: "100%",
                          padding: "8px",
                          borderRadius: 6,
                          border: "1px solid rgba(0,220,140,0.3)",
                          background: "rgba(0,220,140,0.1)",
                          color: "#00dc8c",
                          fontFamily: "inherit",
                          fontSize: 11,
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        ⬇ DOWNLOAD STEGO IMAGE
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        { label: "KYBER CIPHERTEXT SIZE", value: `${encryptResult.kyber_ct_length} bytes` },
                        { label: "TOTAL PAYLOAD SIZE", value: `${encryptResult.payload_bytes} bytes` },
                        { label: "IMAGE CAPACITY", value: `${encryptResult.image_capacity_bits} bits` },
                        { label: "AES MODE", value: encryptResult.aes_mode },
                        { label: "ENCAPSULATION TIME", value: `${encryptResult.encaps_time_ms} ms` },
                        { label: "AES ENCRYPTION TIME", value: `${encryptResult.aes_enc_time_ms} ms` },
                        { label: "PSNR", value: `${encryptResult.psnr} dB` },
                        { label: "SSIM", value: `${encryptResult.ssim}` },
                        { label: "IV (Base64)", value: encryptResult.iv_b64 },
                        { label: "AUTH TAG (Base64)", value: encryptResult.auth_tag_b64 },
                        { label: "SESSION ID", value: sessionId },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          style={{
                            background: "rgba(0,220,140,0.05)",
                            border: "1px solid rgba(0,220,140,0.15)",
                            borderRadius: 8,
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ fontSize: 9, color: "#00dc8c80", marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 10, color: "#00dc8c", wordBreak: "break-all" }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Decrypt Panel */
            <div
              style={{
                background: "rgba(0,15,25,0.7)",
                border: "1px solid rgba(0,200,220,0.15)",
                borderRadius: 12,
                padding: "1.5rem",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#00c8dc", marginBottom: 16 }}>
                🔓 Phase 7 — Extract & Decrypt
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                {/* Stego image upload */}
                <div>
                  <label style={{ fontSize: 11, color: "#ffffff60", display: "block", marginBottom: 6 }}>
                    STEGO IMAGE
                  </label>
                  <div
                    onClick={() => stegoRef.current.click()}
                    style={{
                      border: "2px dashed rgba(0,200,220,0.25)",
                      borderRadius: 8,
                      height: 140,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      overflow: "hidden",
                    }}
                  >
                    {stegoUpload ? (
                      <img
                        src={URL.createObjectURL(stegoUpload)}
                        alt="stego upload"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ textAlign: "center", color: "#ffffff40" }}>
                        <div style={{ fontSize: 24 }}>📥</div>
                        <div style={{ fontSize: 11, marginTop: 4 }}>Upload stego image</div>
                      </div>
                    )}
                  </div>
                  <input
                    ref={stegoRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setStegoUpload(e.target.files[0])}
                    style={{ display: "none" }}
                  />
                </div>

                {/* Session ID */}
                <div>
                  <label style={{ fontSize: 11, color: "#ffffff60", display: "block", marginBottom: 6 }}>
                    SESSION ID (from sender)
                  </label>
                  <textarea
                    value={stegoSessionId}
                    onChange={(e) => setStegoSessionId(e.target.value)}
                    placeholder="Paste the session ID here..."
                    rows={4}
                    style={{
                      width: "100%",
                      background: "rgba(0,30,50,0.5)",
                      border: "1px solid rgba(0,200,220,0.2)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      color: "#e0e8f0",
                      fontFamily: "inherit",
                      fontSize: 11,
                      resize: "none",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "#ffffff30", marginTop: 4 }}>
                    Use current session: <span
                      style={{ color: "#00c8dc", cursor: "pointer" }}
                      onClick={() => setStegoSessionId(sessionId || "")}
                    >
                      copy from session
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleDecrypt}
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 8,
                  border: "none",
                  background: loading ? "#0d2040" : "linear-gradient(135deg,#800060,#c000a0)",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  letterSpacing: 2,
                }}
              >
                {loading ? "⏳ EXTRACTING..." : "🔓 EXTRACT & DECRYPT MESSAGE"}
              </button>

              {decryptResult && (
                <div
                  style={{
                    marginTop: 20,
                    padding: 16,
                    background: "rgba(0,220,140,0.05)",
                    border: "1px solid rgba(0,220,140,0.25)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 18 }}>✅</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#00dc8c" }}>
                      Message Decrypted Successfully
                    </span>
                    {decryptResult.integrity_verified && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 8px",
                          background: "rgba(0,220,140,0.15)",
                          border: "1px solid rgba(0,220,140,0.3)",
                          borderRadius: 4,
                          color: "#00dc8c",
                        }}
                      >
                        INTEGRITY VERIFIED ✓
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid rgba(0,220,140,0.2)",
                      borderRadius: 8,
                      padding: "12px 14px",
                      fontSize: 14,
                      color: "#e0e8f0",
                      lineHeight: 1.6,
                    }}
                  >
                    {decryptResult.message}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10, color: "#ffffff40", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                    <span>Algorithm: {decryptResult.algorithm} | Kyber CT: {decryptResult.kyber_ct_length} bytes</span>
                    <span>Decapsulation Time: {decryptResult.decaps_time_ms} ms | AES Decryption Time: {decryptResult.aes_dec_time_ms} ms | Extraction Success: {decryptResult.extraction_success ? "Yes" : "No"}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Algorithm info footer */}
          <div
            style={{
              background: "rgba(0,15,25,0.5)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12,
              padding: "1rem 1.5rem",
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 12,
            }}
          >
            {[
              {
                title: "ML-KEM-768",
                sub: "FIPS 203 (NIST PQC)",
                desc: "Module lattice-based KEM. Quantum-safe key encapsulation. 1184-byte public key.",
                color: "#00c8dc",
              },
              {
                title: "AES-256-GCM",
                sub: "Authenticated Encryption",
                desc: "256-bit key, 12-byte IV, 16-byte auth tag. Provides confidentiality + integrity.",
                color: "#c0a000",
              },
              {
                title: "LSB Steganography",
                sub: "Covert Channel",
                desc: "1 bit per pixel channel. Payload hidden without visible image distortion.",
                color: "#a000c0",
              },
            ].map((a) => (
              <div key={a.title}>
                <div style={{ fontSize: 11, fontWeight: 700, color: a.color }}>{a.title}</div>
                <div style={{ fontSize: 9, color: `${a.color}80`, marginBottom: 4 }}>{a.sub}</div>
                <div style={{ fontSize: 10, color: "#ffffff50", lineHeight: 1.5 }}>{a.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
