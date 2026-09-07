// MIT License — Copyright (c) 2026 Mateus Gaio
import { Plus, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";

export type DatafortPropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime";

export type DatafortProperty = {
  key: string;
  raw: string;
  type: DatafortPropertyType;
  value: boolean | number | string | string[];
  readonly: boolean;
};

const INTERNAL_PROPERTIES = new Set([
  "created_at",
  "id",
  "revision_id",
  "source",
  "source_kind",
  "status",
  "type",
  "updated_at",
]);

function splitList(raw: string) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed))
        return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      // Fallback to the conservative comma parser below.
    }
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return value
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function inferProperty(key: string, raw: string): Pick<DatafortProperty, "type" | "value"> {
  const value = raw.trim();
  const lowerKey = key.toLocaleLowerCase();
  if (lowerKey === "tags" || lowerKey === "aliases")
    return { type: "list", value: splitList(value) };
  if (value === "true" || value === "false") return { type: "checkbox", value: value === "true" };
  if (/^\d{4}-\d{2}-\d{2}t/i.test(value)) return { type: "datetime", value };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: "date", value };
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value) && Number.isFinite(Number(value)))
    return { type: "number", value: Number(value) };
  if (value.startsWith("[") && value.endsWith("]"))
    return { type: "list", value: splitList(value) };
  return { type: "text", value: value.replace(/^['"]|['"]$/g, "") };
}

export function parseDatafortProperties(content: string): DatafortProperty[] {
  const match = content.match(/^---\r?\n([\s\S]*?)(?:\r?\n)---(?:\r?\n|$)/);
  if (!match?.[1]) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/))
    .filter((entry): entry is RegExpMatchArray => Boolean(entry))
    .map((entry) => {
      const key = entry[1] ?? "";
      const raw = entry[2] ?? "";
      return {
        key,
        raw,
        ...inferProperty(key, raw),
        readonly: INTERNAL_PROPERTIES.has(key.toLocaleLowerCase()),
      };
    });
}

function yamlValue(type: DatafortPropertyType, value: string | boolean) {
  if (type === "checkbox") return value === true || value === "true" ? "true" : "false";
  if (type === "list") {
    const values = String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return `[${values.map((item) => JSON.stringify(item)).join(", ")}]`;
  }
  const text = String(value).trim();
  return /[:#{}[\],&*?|<>!=%@`]/.test(text) ? JSON.stringify(text) : text;
}

export function updateDatafortProperty(
  content: string,
  key: string,
  type: DatafortPropertyType,
  value: string | boolean,
) {
  const serialized = yamlValue(type, value);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linePattern = new RegExp(`^${escapedKey}:\\s*.*$`, "m");
  if (linePattern.test(content)) return content.replace(linePattern, `${key}: ${serialized}`);
  const closing = content.match(/^(---\r?\n[\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!closing?.[1] || !closing[2]) return content;
  return `${closing[1]}\n${key}: ${serialized}${closing[2]}${content.slice(closing[0].length)}`;
}

function valueForInput(property: DatafortProperty) {
  if (property.type === "checkbox") return property.value === true ? "true" : "false";
  if (property.type === "list")
    return Array.isArray(property.value) ? property.value.join(", ") : "";
  return String(property.value);
}

function inputType(type: DatafortPropertyType) {
  if (type === "number") return "number";
  if (type === "date") return "date";
  if (type === "datetime") return "datetime-local";
  return "text";
}

export function DatafortProperties({
  content,
  onChange,
  readOnly,
}: {
  content: string;
  onChange: (content: string) => void;
  readOnly: boolean;
}) {
  const properties = useMemo(() => parseDatafortProperties(content), [content]);
  const [invalid, setInvalid] = useState<Record<string, string>>({});

  function changeProperty(property: DatafortProperty, value: string | boolean) {
    if (property.readonly || readOnly) return;
    if (property.type === "number" && (value === "" || !Number.isFinite(Number(value)))) {
      setInvalid((current) => ({ ...current, [property.key]: "Informe um número válido." }));
      return;
    }
    if (
      (property.type === "date" || property.type === "datetime") &&
      value &&
      Number.isNaN(Date.parse(String(value)))
    ) {
      setInvalid((current) => ({ ...current, [property.key]: "Informe uma data válida." }));
      return;
    }
    setInvalid((current) => {
      const next = { ...current };
      delete next[property.key];
      return next;
    });
    onChange(updateDatafortProperty(content, property.key, property.type, value));
  }

  function addProperty() {
    if (readOnly) return;
    const key = window.prompt("Nome da propriedade (a-z, 0-9 e _):", "");
    if (!key || !/^[A-Za-z_][\w-]*$/.test(key) || properties.some((item) => item.key === key))
      return;
    onChange(updateDatafortProperty(content, key, "text", ""));
  }

  return (
    <div className="datafort-properties-editor">
      <div className="datafort-inspector-heading">
        <span>
          <Settings2 size={14} /> Propriedades
        </span>
        <button
          aria-label="Adicionar propriedade"
          className="datafort-icon-button"
          disabled={readOnly}
          onClick={addProperty}
          type="button"
        >
          <Plus size={13} />
        </button>
      </div>
      {properties.length === 0 ? (
        <p className="datafort-empty-copy">Sem propriedades YAML.</p>
      ) : (
        properties.map((property) => {
          const value = valueForInput(property);
          return (
            <div className="datafort-property-field" key={property.key}>
              <label
                className="datafort-property-label"
                htmlFor={`datafort-property-${property.key}`}
              >
                {property.key}
                <small>{property.type}</small>
              </label>
              {property.type === "checkbox" ? (
                <input
                  checked={property.value === true}
                  disabled={property.readonly || readOnly}
                  id={`datafort-property-${property.key}`}
                  onChange={(event) => changeProperty(property, event.target.checked)}
                  type="checkbox"
                />
              ) : (
                <input
                  disabled={property.readonly || readOnly}
                  id={`datafort-property-${property.key}`}
                  onChange={(event) => changeProperty(property, event.target.value)}
                  type={inputType(property.type)}
                  value={
                    property.type === "datetime" ? value.replace(/Z$/, "").slice(0, 16) : value
                  }
                />
              )}
              {property.readonly && <em>interno</em>}
              {invalid[property.key] && (
                <small className="datafort-property-error">{invalid[property.key]}</small>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
