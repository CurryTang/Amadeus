export function getVibeUiMode(uiConfig = {}) {
  const simplifiedAlphaMode = uiConfig?.simplifiedAlphaMode === true;
  return {
    simplifiedAlphaMode,
    showSkillMenu: !simplifiedAlphaMode,
    showTreePlanning: !simplifiedAlphaMode,
    showTreeActions: !simplifiedAlphaMode,
    showAutopilotControls: !simplifiedAlphaMode,
  };
}
