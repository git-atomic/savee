import * as React from "react";

/**
 * Hook for accessing the engine portal container.
 * This ensures all Radix portals render inside the .engine-view scope
 * to inherit proper CSS variables and theming.
 */
export function useEnginePortalContainer() {
  const [el, setEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setEl(document.getElementById("engine-portal-host"));
  }, []);
  return el;
}

