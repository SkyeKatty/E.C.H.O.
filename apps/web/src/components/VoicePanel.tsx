import { useState } from "react";
import { SubNavTabs } from "./SubNavTabs";
import { SttSettingsPanel } from "./SttSettingsPanel";
import { TtsSettingsPanel } from "./TtsSettingsPanel";

type VoiceTab = "stt" | "tts";

export function VoicePanel(props: { sttAvailable: boolean; ttsAvailable: boolean }) {
  const [tab, setTab] = useState<VoiceTab>("stt");

  return (
    <section className="panel voice-panel">
      <SubNavTabs
        tabs={[
          { id: "stt", label: "Speech-to-text" },
          { id: "tts", label: "Text-to-speech" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "stt" ? (
        <SttSettingsPanel moduleAvailable={props.sttAvailable} />
      ) : (
        <TtsSettingsPanel moduleAvailable={props.ttsAvailable} />
      )}
    </section>
  );
}
