export type NotificationDecision = 'no_consent' | 'no_prefs' | 'sent';

export async function deliverNotification(options: {
  consented: boolean;
  prefs: Record<string, boolean> | null | undefined;
  send: () => Promise<void>;
}): Promise<NotificationDecision> {
  if (!options.consented) return 'no_consent';
  const enabled = Object.values(options.prefs ?? {}).some((value) => value === true);
  if (!enabled) return 'no_prefs';
  await options.send();
  return 'sent';
}
