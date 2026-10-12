"use client";

import { createContext, useContext } from "react";
import { DEFAULT_TZ } from "@/lib/datetime";

// Часовой пояс проекта (настройка «Часовой пояс» в «Настройках») — в нём
// показываются все даты и время в разделах проекта.
const TzContext = createContext<string>(DEFAULT_TZ);

export function ProjectTimeProvider({ timezone, children }: { timezone: string; children: React.ReactNode }) {
  return <TzContext.Provider value={timezone}>{children}</TzContext.Provider>;
}

export function useProjectTz(): string {
  return useContext(TzContext);
}
