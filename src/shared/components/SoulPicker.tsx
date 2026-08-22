/* MIT License — Copyright (c) 2026 Mateus Gaio */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/shared/components/ui/textarea";
import { getSoulPreset, identifySoul, SOUL_PRESETS, type SoulPresetId } from "../../app/souls";

type SoulPickerProps = {
  hint: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  rows?: number;
  value: string;
};

export function SoulPicker({ hint, id, label, onChange, rows = 5, value }: SoulPickerProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<SoulPresetId>(() => identifySoul(value));
  const localizedDescriptions: Record<SoulPresetId, string> = {
    blackwall: t("settings.clearPracticalAndPrivacyfirstFor"),
    creative: t("settings.curiousImaginativeAndUsefulWhen"),
    dev: t("settings.aDisciplinedEngineeringPartnerWith"),
    custom: t("settings.writeYourOwnInstructionsAnd"),
  };

  useEffect(() => {
    setSelectedId(identifySoul(value));
  }, [value]);

  function selectPreset(presetId: SoulPresetId) {
    setSelectedId(presetId);
    if (presetId !== "custom") onChange(getSoulPreset(presetId).prompt);
  }

  return (
    <div className="grid gap-2.5">
      <span className="font-mono text-[0.72rem] text-muted-foreground">{label}</span>
      <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0">
        <legend className="sr-only">{t("settings.soulPersonalities")}</legend>
        {SOUL_PRESETS.map((preset) => (
          <button
            aria-pressed={selectedId === preset.id}
            className={`grid min-w-0 gap-[5px] rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:border-ring focus-visible:outline-none ${
              selectedId === preset.id
                ? "border-ring bg-accent text-foreground"
                : "border-border text-muted-foreground hover:border-ring hover:text-foreground"
            }`}
            key={preset.id}
            onClick={() => selectPreset(preset.id)}
            type="button"
          >
            <strong className="text-[0.82rem] font-medium">
              {preset.id === "blackwall"
                ? "Builder"
                : preset.id === "creative"
                  ? t("settings.creative")
                  : preset.id === "dev"
                    ? "Dev"
                    : t("settings.custom")}
            </strong>
            <small className="text-[0.67rem] leading-snug">
              {localizedDescriptions[preset.id]}
            </small>
          </button>
        ))}
      </fieldset>
      <Textarea
        aria-label={t("settings.soulPrompt")}
        className="min-h-[132px]"
        id={id}
        onChange={(event) => {
          setSelectedId("custom");
          onChange(event.target.value);
        }}
        rows={rows}
        value={value}
      />
      <span className="font-sans text-[0.76rem] leading-snug tracking-normal text-muted-foreground">
        {hint}
      </span>
    </div>
  );
}
