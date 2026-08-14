/* MIT License — Copyright (c) 2026 Mateus Gaio */
import { useEffect, useState } from "react";
import { getSoulPreset, identifySoul, SOUL_PRESETS, type SoulPresetId } from "../../app/souls";

type SoulPickerProps = {
  hint: string;
  id: string;
  label: string;
  locale: "pt-BR" | "en";
  onChange: (value: string) => void;
  rows?: number;
  value: string;
};

export function SoulPicker({
  hint,
  id,
  label,
  locale,
  onChange,
  rows = 5,
  value,
}: SoulPickerProps) {
  const [selectedId, setSelectedId] = useState<SoulPresetId>(() => identifySoul(value));
  const isEnglish = locale === "en";
  const localizedDescriptions: Record<SoulPresetId, string> = {
    blackwall: isEnglish
      ? "Clear, practical and privacy-first for building software."
      : "Clara, prática e local-first para construir software.",
    creative: isEnglish
      ? "Curious, imaginative and useful when exploring new directions."
      : "Curiosa, imaginativa e útil para explorar novas direções.",
    dev: isEnglish
      ? "A disciplined engineering partner with repository-quality guardrails."
      : "Uma parceira de engenharia com guardrails de qualidade do repositório.",
    custom: isEnglish
      ? "Write your own instructions and keep them local to this profile."
      : "Escreva suas próprias instruções e mantenha-as neste perfil.",
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
        <legend className="sr-only">
          {isEnglish ? "Soul personalities" : "Personalidades de Soul"}
        </legend>
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
                  ? isEnglish
                    ? "Creative"
                    : "Criativa"
                  : preset.id === "dev"
                    ? "Dev"
                    : isEnglish
                      ? "Custom"
                      : "Personalizada"}
            </strong>
            <small>{localizedDescriptions[preset.id]}</small>
          </button>
        ))}
      </fieldset>
      <textarea
        aria-label={isEnglish ? "Soul prompt" : "Prompt da Soul"}
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
