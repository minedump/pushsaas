"use client";

import { useState } from "react";
import { Button, SegmentedControl } from "@/app/ui";
import { INSTALL_BUTTON_RADIUS_PX, installStepImageUrl, type InstallConfig, type InstallPlatform } from "@/lib/install-guide";
import { INSTALL_UI, PHONE_ANDROID_SVG, PHONE_IOS_SVG, installTint } from "@/lib/install-widget";
import { CLOSE_SVG } from "@/lib/widget-scripts";
import { DeviceStage, PreviewCard, type PreviewDevice } from "./DevicePreview";

type Mode = "tabs" | "ios" | "android";

// **жирный** — как названия кнопок в инструкции (то же правило, что в скрипте окна)
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) => (part ? i % 2 ? <strong key={i} style={{ fontWeight: 600 }}>{part}</strong> : <span key={i}>{part}</span> : null))}
    </>
  );
}

// Живой мокап окна «Установка приложения»: разметка и цвета те же, что у окна,
// которое строит скрипт (lib/install-widget.ts), — константы INSTALL_UI общие.
// Картинки шагов — те же адреса, что получит сайт: схему рисует сервер по данным
// проекта (иконка, название, цвет из манифеста), своя картинка — прямая ссылка.
export default function InstallPreview({ config, projectId, version }: { config: InstallConfig; projectId: string; version: string }) {
  const [device, setDevice] = useState<PreviewDevice>("phone");
  const [mode, setMode] = useState<Mode>("tabs");
  const [platform, setPlatform] = useState<InstallPlatform>("ios");
  const [open, setOpen] = useState(true);

  const phone = device === "phone";
  const shown: InstallPlatform = mode === "tabs" ? platform : mode;
  const steps = config[shown];
  const u = INSTALL_UI;
  const c = config.buttonColor;

  return (
    <PreviewCard
      value={device}
      onChange={setDevice}
      options={[
        { value: "phone", label: "Телефон" },
        { value: "desktop", label: "Компьютер" },
      ]}
    >
      <SegmentedControl
        value={mode}
        onChange={(v) => {
          setMode(v);
          setOpen(true);
        }}
        options={[
          { value: "tabs", label: "С вкладками" },
          { value: "ios", label: "Только iPhone" },
          { value: "android", label: "Только Android" },
        ]}
        className="mt-3 flex-wrap"
      />
      {!config.enabled && <p className="text-xs text-ink-faint mt-2 mb-0">Виджет выключен — на сайте окно не откроется, пока вы его не включите и не сохраните.</p>}

      <DeviceStage device={device}>
        {open ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              background: u.overlay,
              display: "flex",
              alignItems: phone ? "flex-end" : "center",
              justifyContent: "center",
              padding: phone ? 0 : 16,
            }}
          >
            <div
              role="dialog"
              aria-label={config.title}
              style={{
                background: u.dialogBg,
                color: u.text,
                width: "100%",
                maxWidth: phone ? "none" : 460,
                maxHeight: phone ? "90%" : "94%",
                borderRadius: phone ? "18px 18px 0 0" : 14,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                fontFamily: u.font,
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${u.line}`, flex: "none" }}>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>{config.title}</div>
                <button
                  type="button"
                  aria-label="Закрыть"
                  onClick={() => setOpen(false)}
                  style={{ flex: "none", width: 32, height: 32, border: 0, borderRadius: 8, background: "transparent", color: u.faint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                  dangerouslySetInnerHTML={{ __html: CLOSE_SVG }}
                />
              </div>

              <div className="pretty-scroll" style={{ padding: "14px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
                {config.intro && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: u.muted }}>{config.intro}</p>}

                {mode === "tabs" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {(["ios", "android"] as InstallPlatform[]).map((p) => {
                      const on = platform === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setPlatform(p)}
                          style={{
                            border: `1px solid ${on ? c : u.tileBorder}`,
                            boxShadow: on ? `0 0 0 1px ${c}` : "none",
                            background: on ? installTint(c) : u.dialogBg,
                            color: on ? u.text : u.muted,
                            borderRadius: 12,
                            padding: "10px 8px 9px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 6,
                            fontFamily: "inherit",
                            fontSize: 13.5,
                            fontWeight: 500,
                            lineHeight: 1.2,
                            cursor: "pointer",
                          }}
                        >
                          <span dangerouslySetInnerHTML={{ __html: p === "ios" ? PHONE_IOS_SVG : PHONE_ANDROID_SVG }} style={{ display: "flex" }} />
                          {p === "ios" ? "iPhone" : "Android"}
                        </button>
                      );
                    })}
                  </div>
                )}

                {steps.length === 0 ? (
                  <div style={{ fontSize: 13.5, color: u.muted }}>Инструкция для этой платформы пока не заполнена.</div>
                ) : (
                  <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 20 }}>
                    {steps.map((s, i) => {
                      const img = installStepImageUrl("", projectId, s, version);
                      return (
                        <li key={i}>
                          <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: u.muted }}>Шаг {i + 1}</p>
                          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
                            <RichText text={s.text} />
                          </p>
                          {img && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={img}
                              alt=""
                              style={{ display: "block", width: "100%", height: "auto", marginTop: 8, borderRadius: 10, border: `1px solid ${u.imgBorder}`, background: u.imgBg }}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <div style={{ padding: "12px 16px 16px", borderTop: `1px solid ${u.line}`, flex: "none" }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{ width: "100%", height: 40, border: 0, borderRadius: INSTALL_BUTTON_RADIUS_PX[config.buttonRadius], background: c, color: config.buttonTextColor, fontFamily: "inherit", fontSize: 14, fontWeight: 600, lineHeight: 1, cursor: "pointer" }}
                >
                  {config.buttonText}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 z-[5] flex items-center justify-center">
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Показать окно
            </Button>
          </div>
        )}
      </DeviceStage>
    </PreviewCard>
  );
}
