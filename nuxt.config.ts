import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  nitro: {
    scanDirs: [
      fileURLToPath(new URL("./server/auth", import.meta.url)),
      fileURLToPath(new URL("./server/admin", import.meta.url)),
      fileURLToPath(new URL("./server/settings", import.meta.url)),
      fileURLToPath(new URL("./server/projects", import.meta.url)),
      fileURLToPath(new URL("./server/agents", import.meta.url)),
      fileURLToPath(new URL("./server/shared", import.meta.url)),
    ],
    alias: {
      "@su": fileURLToPath(new URL("./server/shared/utils", import.meta.url)),
      "@db": fileURLToPath(new URL("./server/shared/database", import.meta.url)),
    },
    typescript: {
      tsConfig: {
        compilerOptions: {
          paths: {
            "@su/*": ["../server/shared/utils/*"],
            "@db/*": ["../server/shared/database/*"],
          },
        },
      },
    },
    routeRules: {
      // CSP applies origin-wide because localStorage (where provider API
      // keys are persisted) is shared across all pages on this origin —
      // an XSS on /settings/speckit-agent or any other page would
      // otherwise be able to exfiltrate them. The connect-src allowlist
      // is intentionally narrow: the four LLM provider hosts plus 'self'
      // — that's the real exfil defense once an XSS has executed.
      //
      // 'unsafe-inline' is required because Nuxt injects
      // `<script>window.__NUXT__.config = {...}</script>` inline for
      // client-side runtime-config bootstrap (both dev and prod). Without
      // it, the script is blocked, __NUXT__ stays undefined, and
      // Nuxt's entry crashes with "target argument of Proxy must be an
      // object". Dev mode additionally needs 'unsafe-eval' for Vite HMR.
      "/**": {
        headers: {
          "Content-Security-Policy": [
            "default-src 'self'",
            "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://openrouter.ai",
            process.env.NODE_ENV === "production"
              ? "script-src 'self' 'unsafe-inline'"
              : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      },
    },
  },
  typescript: {
    tsConfig: {
      compilerOptions: {
        paths: {
          "@su/*": ["../server/shared/utils/*"],
          "@db/*": ["../server/shared/database/*"],
        },
      },
    },
  },
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  imports: {
    dirs: ["composables/**"],
  },
  css: ["~/assets/css/tailwind.css"],
  components: [
    {
      path: "~/components",
      extensions: [".vue"],
    },
  ],
  modules: ["shadcn-nuxt", "@nuxtjs/i18n", "@pinia/nuxt"],
  vite: {
    plugins: [tailwindcss()],
  },
  shadcn: {
    prefix: "",
    componentDir: "./app/components/shadcn",
  },
  runtimeConfig: {
    companyClaudeProxyUrl: process.env.COMPANY_CLAUDE_PROXY_URL ?? "",
    companyOpsUrlBase:
      process.env.COMPANY_OPS_URL_BASE ?? "http://specifyr:3000/mcp",
    public: {
      appName: "specifyr",
      // Public so the Logout link can point at it. Set per-deployment
      // (in ansible's .env.j2 → AUTHENTIK_HOST). Empty string disables
      // the Logout link (dev mode w/o IDP).
      authHost: process.env.AUTHENTIK_HOST ?? "",
      // Truthy iff SPECIFYR_DEV_USER_EMAIL is set on the server. The
      // value itself stays server-side (display-only); we just need a
      // boolean so the UI can render the Sign-in (dev) button only when
      // it would actually do something.
      devAuthAvailable: !!process.env.SPECIFYR_DEV_USER_EMAIL,
    },
  },
  // English is bootstrap-only: en.json contains the small set of
  // user-facing labels that have been translated. Untranslated keys
  // fall back to German via `fallbackLocale` so the UI stays usable
  // while the translation effort catches up.
  //
  // `code as LocaleCode` widens the inferred literal so adding additional
  // locales doesn't break the LocaleObject<T> array element type, and
  // matches the union expected by `defaultLocale`/`fallbackLocale`.
  i18n: (() => {
    type LocaleCode = "de" | "en";
    return {
      locales: [
        { code: "de" as LocaleCode, language: "de-DE", file: "de.json", name: "Deutsch" },
        { code: "en" as LocaleCode, language: "en-US", file: "en.json", name: "English" },
      ],
      defaultLocale: "de" as LocaleCode,
      fallbackLocale: "de" as LocaleCode,
    };
  })(),
});
