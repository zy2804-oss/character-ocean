export const themes = {
  light: { label: "Day", page: "#ffffff" },
  dark: { label: "Night", page: "#07111a" },
  deep: { label: "Deep Water", page: "#082b40" },
} as const;

export type OceanTheme = keyof typeof themes;
