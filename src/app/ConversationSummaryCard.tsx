// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SafeMarkdown } from "../shared/components/SafeMarkdown";

type ConversationSummaryCardProps = {
  content: string;
};

function reducedMotionPreferred() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ConversationSummaryCard({ content }: ConversationSummaryCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [bodyVisible, setBodyVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function toggle() {
    if (expanded) {
      setExpanded(false);
      setLeaving(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => {
          setBodyVisible(false);
          setLeaving(false);
        },
        reducedMotionPreferred() ? 0 : 140,
      );
      return;
    }
    setBodyVisible(true);
    setLeaving(false);
    setExpanded(true);
  }

  return (
    <li className="message conversation-summary-card">
      <button
        aria-expanded={expanded}
        className="conversation-summary-toggle"
        onClick={toggle}
        type="button"
      >
        <span className="conversation-summary-label">{t("chat.automaticConversationSummary")}</span>
        <span aria-hidden="true" className="conversation-summary-chevron">
          {expanded ? "−" : "+"}
        </span>
      </button>
      {bodyVisible ? (
        <div
          className={`conversation-summary-body ${expanded ? "is-open" : ""} ${leaving ? "is-leaving" : ""}`}
        >
          <SafeMarkdown content={content} />
        </div>
      ) : null}
    </li>
  );
}
