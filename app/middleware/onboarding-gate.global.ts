/**
 * Mandatory-org gate. Two symmetric redirects, both gated on the
 * caller's `memberships.length`:
 *
 *   - User with 0 memberships, NOT on /onboarding → /onboarding/create-org.
 *     Without this they could click around the app but every
 *     project-creating action would 400 with "create or join an
 *     organization first".
 *   - User with ≥1 memberships, ON /onboarding/* → /. Onboarding is
 *     a one-shot funnel; manually navigating back to it after creating
 *     an org would otherwise show a dead-end form.
 *
 * Skipped: /invites/* and platform admins. Accepting an invite creates
 * the first membership, which clears the gate naturally; intercepting
 * it here would race with the accept POST. Platform admins must be
 * able to reach /admin without first creating an org (the control
 * plane is independent of org membership).
 *
 * `me` is fetched via useFetch which is async; without awaiting the
 * refresh, `me.value` is null when the middleware runs on the first
 * SSR pass, so the gate silently returns and the server renders the
 * un-redirected page. Once useFetch resolves on the client, the
 * middleware re-runs and redirects — causing a hydration mismatch
 * between the SSR'd index.vue and the client's create-org.vue.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith("/invites")) return;

  const { me, refresh } = useMe();
  if (!me.value) await refresh();
  // Unauthenticated users hit Authentik first; this gate doesn't
  // apply to them.
  if (!me.value) return;

  if (me.value.isPlatformAdmin) return;

  const hasMemberships = me.value.memberships.length > 0;
  const onOnboarding = to.path.startsWith("/onboarding");

  if (!hasMemberships && !onOnboarding) {
    return navigateTo("/onboarding/create-org");
  }
  if (hasMemberships && onOnboarding) {
    return navigateTo("/");
  }
});
