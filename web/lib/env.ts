export function demoMode() {
  const enabled = process.env.DEMO_MODE === "true";
  if (
    enabled &&
    !["local", "test"].includes(process.env.APP_ENV || "production")
  ) {
    throw new Error("Demo mode is forbidden outside local/test environments");
  }
  return enabled;
}
