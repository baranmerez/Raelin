import type { ToneName } from "./types";

export interface Tone {
  label: string;
  fill: string;
  border: string;
  ink: string;
  solid: string;
  wash: string;
}

/** Pastel workshop palette. `wash` is the soft region background. */
export const tones: Record<ToneName, Tone> = {
  lilac: {
    label: "Lila",
    fill: "#efe6fb",
    border: "#b79be6",
    ink: "#3b2a63",
    solid: "#c9b2ef",
    wash: "rgba(226, 208, 250, 0.42)",
  },
  peach: {
    label: "Şeftali",
    fill: "#fde4dc",
    border: "#ec8f7a",
    ink: "#5e2a1f",
    solid: "#f5b5a4",
    wash: "rgba(253, 222, 210, 0.45)",
  },
  periwinkle: {
    label: "Mavi",
    fill: "#e3e8fb",
    border: "#8c9ad9",
    ink: "#26305e",
    solid: "#b7c2f0",
    wash: "rgba(214, 222, 250, 0.45)",
  },
  sage: {
    label: "Adaçayı",
    fill: "#dfecd6",
    border: "#8fb27e",
    ink: "#2b4321",
    solid: "#b9d4aa",
    wash: "rgba(214, 233, 204, 0.5)",
  },
  butter: {
    label: "Krem",
    fill: "#fdf1c9",
    border: "#e2c164",
    ink: "#5a4510",
    solid: "#f6dc8c",
    wash: "rgba(253, 240, 199, 0.55)",
  },
  paper: {
    label: "Kâğıt",
    fill: "#ffffff",
    border: "#cfc6d9",
    ink: "#2e2838",
    solid: "#ebe6ef",
    wash: "rgba(255, 255, 255, 0.6)",
  },
};

export const toneOrder: ToneName[] = ["lilac", "peach", "periwinkle", "sage", "butter", "paper"];

export const penColors = ["#3f5f9e", "#ec7f69", "#8e6bd1", "#6f9a5c", "#d9a93a", "#2e2838"];
