/** Server-side demo mode for App Store review. Remove DEMO_MODE env var to disable. */
export const isDemoMode = () => process.env.DEMO_MODE === 'true'
