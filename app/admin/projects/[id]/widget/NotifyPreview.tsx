"use client";

import { useMemo, useState } from "react";
import { CustomSelect } from "@/app/ui/CustomSelect";
import type { NotifyConfig } from "@/lib/notify-config";
import { notifyBlock, type NotifyView } from "@/lib/notify-widget";
import { GUIDE_TAB_LABEL } from "@/lib/notify-config";
import { PreviewCard, type PreviewDevice } from "./DevicePreview";

// Предпросмотр окна уведомлений — настоящий скрипт виджета (lib/notify-widget.ts в режиме "static"),
// запущенный в изолированной рамке поверх заглушки витрины. Поэтому внешний вид и поведение здесь
// не могут разойтись с тем, что увидит посетитель на сайте. Рамка перезагружается при каждой правке настроек.

export type PreviewScene = NotifyView | "bell";

const SCENE_LABEL: Record<PreviewScene, string> = {
  offer: "Предложение",
  blocked: "Выключено в браузере",
  subscribed: "Подписан",
  home: "iPhone без «Домой»",
  done: "Готово",
  unsupported: "Не поддерживается",
  bell: "Иконка",
};
const SCENES: PreviewScene[] = ["offer", "blocked", "subscribed", "home", "done", "bell"];
const TABS = ["ios", "android", "chrome", "firefox", "safari"] as const;
const SKELETON =
  '<div class="h"></div><div class="g"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>';

function frameHtml(config: NotifyConfig, scene: PreviewScene, tab: string, installOn: boolean): string {
  const js = notifyBlock("preview", { ...config, windowEnabled: true, bellEnabled: true }, "static", installOn);
  const call = scene === "bell" ? "window.__pssNotify.bell();" : `window.__pssNotify.show(${JSON.stringify(scene)}, ${JSON.stringify(tab)});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#fff;font-family:-apple-system,'Segoe UI',sans-serif}
.h{margin:14px;height:70px;border-radius:10px;background:#eef1f5}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin:14px}
.g i{display:block;height:84px;border-radius:8px;background:#f3f5f8;border:1px solid #e6e9ee}</style></head><body>${SKELETON}
<script>window.sendera={isSubscribed:function(){return Promise.resolve(false)},subscribe:function(){return Promise.resolve()},event:function(){},openInstallGuideIos:function(){}};</script>
<script>${js}</script>
<script>${call}</script></body></html>`;
}

export default function NotifyPreview({ config, installEnabled }: { config: NotifyConfig; installEnabled: boolean }) {
  const [device, setDevice] = useState<PreviewDevice>("phone");
  const [scene, setScene] = useState<PreviewScene>("offer");
  const [tab, setTab] = useState<string>("android");
  const html = useMemo(() => frameHtml(config, scene, tab, installEnabled), [config, scene, tab, installEnabled]);
  const needsTab = scene === "blocked" || scene === "subscribed";

  return (
    <PreviewCard
      value={device}
      onChange={setDevice}
      options={[
        { value: "phone", label: "Телефон" },
        { value: "desktop", label: "Компьютер" },
      ]}
    >
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CustomSelect
          value={scene}
          onChange={(v) => setScene(v as PreviewScene)}
          options={SCENES.map((s) => ({ value: s, label: SCENE_LABEL[s] }))}
          className="w-full"
        />
        {needsTab && (
          <CustomSelect
            value={tab}
            onChange={(v) => setTab(v)}
            options={TABS.map((t) => ({ value: t, label: GUIDE_TAB_LABEL[t] }))}
            className="w-full"
          />
        )}
      </div>
      <div className="mt-3 flex justify-center rounded-xl border border-border bg-surface-2 px-3 py-5">
        <div
          className={
            device === "phone"
              ? "relative w-full max-w-[290px] aspect-[9/19.5] rounded-[36px] border-[7px] border-ink bg-surface overflow-hidden"
              : "relative w-full h-[420px] rounded-[10px] border border-border-strong bg-surface overflow-hidden"
          }
        >
          <iframe title="Предпросмотр окна уведомлений" srcDoc={html} sandbox="allow-scripts" className="absolute inset-0 w-full h-full border-0" />
        </div>
      </div>
    </PreviewCard>
  );
}
