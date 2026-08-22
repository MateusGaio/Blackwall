/* MIT License — Copyright (c) 2026 Mateus Gaio */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
    <div className="soul-picker">
      <span className="soul-picker-label">{label}</span>
      <fieldset className="soul-preset-list">
        <legend className="sr-only">{t("settings.soulPersonalities")}</legend>
        {SOUL_PRESETS.map((preset) => (
          <button
            aria-pressed={selectedId === preset.id}
            className={`soul-preset-option ${selectedId === preset.id ? "is-selected" : ""}`}
            key={preset.id}
            onClick={() => selectPreset(preset.id)}
            type="button"
          >
            <strong>
              {preset.id === "blackwall"
                ? "Builder"
                : preset.id === "creative"
                  ? t("settings.creative")
                  : preset.id === "dev"
                    ? "Dev"
                    : t("settings.custom")}
            </strong>
            <small>{localizedDescriptions[preset.id]}</small>
          </button>
        ))}
      </fieldset>
      <textarea
        aria-label={t("settings.soulPrompt")}
        className="soul-picker-editor"
        id={id}
        onChange={(event) => {
          setSelectedId("custom");
          onChange(event.target.value);
        }}
        rows={rows}
        value={value}
      />
      <span className="field-hint">{hint}</span>
    </div>
  );
}
