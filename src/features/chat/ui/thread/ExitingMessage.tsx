// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useState } from "react";
import type { ChatMessage } from "../../../../shared/api/sidecar";
import { EnterExit } from "../../../../shared/components/motion/EnterExit";
import { messageClasses } from "./messageClasses";
import { RoleMarker } from "./RoleMarker";

/**
 * Mensagem removida da lista (regenerar/editar) que permanece montada apenas
 * para executar a transição de saída (ADR-09 item 3) antes de desmontar.
 */
export function ExitingMessage({
  message,
  onExited,
}: {
  message: ChatMessage;
  onExited: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (leaving) return;
    const frame = requestAnimationFrame(() => setLeaving(true));
    return () => cancelAnimationFrame(frame);
  }, [leaving]);
  return (
    <EnterExit as="li" onExited={onExited} show={!leaving}>
      <div className={messageClasses(message.role)}>
        <RoleMarker role={message.role} />
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </EnterExit>
  );
}
