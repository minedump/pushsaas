"use client";

import { useMemo, useState } from "react";
import { CustomSelect } from "@/app/ui/CustomSelect";
import type { NotifyConfig } from "@/lib/notify-config";
import { notifyBlock, type NotifyView } from "@/lib/notify-widget";
import { DeviceStage, PreviewCard, type PreviewDevice } from "./DevicePreview";

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

function frameHtml(config: NotifyConfig, scene: PreviewScene, tab: string, installOn: boolean): string {
  const js = notifyBlock("preview", { ...config, windowEnabled: true, bellEnabled: true }, "static", installOn);
  const call = scene === "bell" ? "window.__pssNotify.bell();" : `window.__pssNotify.show(${JSON.stringify(scene)}, ${JSON.stringify(tab)});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:-apple-system,'Segoe UI',sans-serif}</style></head><body>
<script>window.sendera={isSubscribed:function(){return Promise.resolve(false)},subscribe:function(){return Promise.resolve()},event:function(){},openInstallGuideIos:function(){}};</script>
<script>${js}</script>
<script>${call}</script></body></html>`;
}

export default function NotifyPreview({ config, installEnabled }: { config: NotifyConfig; installEnabled: boolean }) {
  const [device, setDevice] = useState<PreviewDevice>("phone");
  const [scene, setScene] = useState<PreviewScene>("offer");
  // с какой инструкции начать; дальше устройство переключается вкладками внутри окна (они есть только в предпросмотре)
  const tab = device === "phone" ? "ios" : "chrome";
  const html = useMemo(() => frameHtml(config, scene, tab, installEnabled), [config, scene, tab, installEnabled]);

  return (
    <PreviewCard
      value={device}
      onChange={setDevice}
      options={[
        { value: "phone", label: "Телефон" },
        { value: "desktop", label: "Компьютер" },
      ]}
      controls={
        <CustomSelect
          value={scene}
          onChange={(v) => setScene(v as PreviewScene)}
          options={SCENES.map((s) => ({ value: s, label: SCENE_LABEL[s] }))}
          className="w-[210px]"
        />
      }
    >
      {/* тот же макет и заглушка витрины, что у остальных виджетов; рамка со скриптом прозрачная и лежит поверх */}
      <DeviceStage device={device}>
        <iframe
          title="Предпросмотр окна уведомлений"
          srcDoc={html}
          sandbox="allow-scripts"
          className="absolute inset-0 w-full h-full border-0 bg-transparent"
          style={{ colorScheme: "normal" }}
        />
      </DeviceStage>
    </PreviewCard>
  );
}
