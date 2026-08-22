// MIT License — Copyright (c) 2026 Mateus Gaio
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Recursos gerados pela migração i18n (Issue #134). Estrutura por seção:
// onboarding, profileChooser, chat, composer, sessions, vault, settings, usage, errors.
void i18n.use(initReactI18next).init({
  fallbackLng: "pt-BR",
  interpolation: { escapeValue: false },
  resources: {
    "pt-BR": {
      translation: {
        brand: {
          note: "Privado por padrão. Seu contexto continua no seu computador.",
        },
        settings: {
          couldNotChooseTheFolder: "Não foi possível escolher a pasta.",
          couldNotCreateTheWorkspace: "Não foi possível criar o workspace.",
          couldNotSaveWorkspaceContext: "Não foi possível salvar o contexto do workspace.",
          workspaceAdded: "Workspace {{name}} adicionado.",
          workspaceContextSavedOnThis: "Contexto do workspace salvo neste dispositivo.",
        },
      },
    },
    en: {
      translation: {
        brand: {
          note: "Private by default. Your context stays on your computer.",
        },
        settings: {
          couldNotChooseTheFolder: "Could not choose the folder.",
          couldNotCreateTheWorkspace: "Could not create the workspace.",
          couldNotSaveWorkspaceContext: "Could not save workspace context.",
          workspaceAdded: "Workspace {{name}} added.",
          workspaceContextSavedOnThis: "Workspace context saved on this device.",
        },
      },
    },
  },
});
