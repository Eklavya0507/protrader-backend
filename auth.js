(() => {
  "use strict";

  const API_BASE = "https://protrader-backend-n8oj.onrender.com/api";
  const TOKEN_KEY = "protrade_auth_token";
  const USER_KEY = "protrade_auth_user";
  const nativeFetch = window.fetch.bind(window);

  const currentPage =
    window.location.pathname.split("/").pop() || "index.html";

  const protectedPages = new Set([
    "dashboard.html",
    "trades.html",
    "calendar.html",
    "analytics.html",
    "psychology.html",
    "ai-journal.html",
    "settings.html",
  ]);

  const isProtectedPage = protectedPages.has(currentPage);

  const safeNextPage = (value) => {
    const candidate = String(value || "").trim();
    return /^[a-z0-9-]+\.html$/i.test(candidate)
      ? candidate
      : "dashboard.html";
  };

  const clearSession = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  };

  const redirectToLogin = () => {
    const next = encodeURIComponent(safeNextPage(currentPage));
    window.location.replace(`login.html?next=${next}`);
  };

  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const apiUrlFromInput = (input) => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url;
    return "";
  };

  const isProtectedApiRequest = (url) =>
    isProtectedPage &&
    url.startsWith(API_BASE) &&
    !url.startsWith(`${API_BASE}/auth/`);

  const secureFetch = async (input, options = {}) => {
    const url = apiUrlFromInput(input);

    if (!isProtectedApiRequest(url)) {
      return nativeFetch(input, options);
    }

    await ready;

    const token = sessionStorage.getItem(TOKEN_KEY);

    if (!token) {
      clearSession();
      redirectToLogin();
      throw new Error("Authentication required.");
    }

    const headers = new Headers(
      options.headers || (input instanceof Request ? input.headers : undefined)
    );

    headers.set("Authorization", `Bearer ${token}`);

    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    const response = await nativeFetch(input, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      clearSession();
      redirectToLogin();
      throw new Error("Your login session has expired.");
    }

    return response;
  };

  // Existing page scripts use fetch(). This override adds the JWT token
  // automatically to Trade, Journal and Settings API requests.
  window.fetch = secureFetch;

  const createAuthOverlay = () => {
    if (!isProtectedPage || document.getElementById("protradeAuthOverlay")) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "protradeAuthOverlay";
    overlay.innerHTML = `
      <div style="
        width:54px;height:54px;border-radius:18px;
        display:flex;align-items:center;justify-content:center;
        background:#1266d9;color:white;font:800 24px/1 Arial,sans-serif;
        box-shadow:0 18px 50px rgba(18,102,217,.35);">P</div>
      <div style="margin-top:18px;font:800 17px/1.3 Arial,sans-serif;color:#eef3f7;">
        Verifying secure session
      </div>
      <div style="margin-top:8px;font:500 13px/1.5 Arial,sans-serif;color:#98a5ad;">
        Loading your private workspace…
      </div>
      <div style="
        width:160px;height:4px;margin-top:18px;border-radius:999px;
        overflow:hidden;background:#252c30;">
        <div style="
          width:45%;height:100%;border-radius:inherit;background:#6f9cff;
          animation:protradeAuthSlide 1s ease-in-out infinite alternate;"></div>
      </div>
    `;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#080b0c",
      textAlign: "center",
    });

    const style = document.createElement("style");
    style.id = "protradeAuthOverlayStyle";
    style.textContent = `
      @keyframes protradeAuthSlide {
        from { transform: translateX(-65%); }
        to { transform: translateX(165%); }
      }
    `;

    document.head.appendChild(style);
    document.body.prepend(overlay);
  };

  const removeAuthOverlay = () => {
    document.getElementById("protradeAuthOverlay")?.remove();
    document.getElementById("protradeAuthOverlayStyle")?.remove();
  };

  const updateUserInterface = (user) => {
    const displayName = user?.name || "Trader";
    const email = user?.email || "";
    const initials = displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "T";

    document
      .querySelectorAll(".auth-user-name, #sidebarProfileName")
      .forEach((element) => {
        element.textContent = displayName;
      });

    document.querySelectorAll(".auth-user-email").forEach((element) => {
      element.textContent = email;
    });

    document.querySelectorAll(".auth-user-initials").forEach((element) => {
      element.textContent = initials;
    });

    // Update old hardcoded profile labels that remain in some page designs.
    document.querySelectorAll("p, span, div").forEach((element) => {
      if (element.children.length > 0) return;

      const value = element.textContent.trim();

      if (["Alex Rivera", "Gautam Kumar", "Gautam"].includes(value)) {
        element.textContent = displayName;
      }

      if (
        value === "alex.rivera@protrade.com" ||
        value === "gautamkuswha4467@gmail.com"
      ) {
        element.textContent = email;
      }
    });

    document.querySelectorAll("[data-auth-logout]").forEach((button) => {
      if (button.dataset.authBound === "true") return;
      button.dataset.authBound = "true";

      button.addEventListener("click", async () => {
        button.disabled = true;
        const oldLabel = button.innerHTML;
        button.innerHTML = "Signing out…";

        try {
          await nativeFetch(`${API_BASE}/auth/logout`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${
                sessionStorage.getItem(TOKEN_KEY) || ""
              }`,
              Accept: "application/json",
            },
          });
        } catch (error) {
          console.warn("Logout API request was not completed:", error);
        } finally {
          clearSession();
          button.innerHTML = oldLabel;
          window.location.replace("login.html?logout=1");
        }
      });
    });
  };

  window.ProTradeAuth = {
    API_BASE,
    TOKEN_KEY,
    USER_KEY,
    ready,
    getToken: () => sessionStorage.getItem(TOKEN_KEY),
    getUser: () => {
      try {
        return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
      } catch {
        return null;
      }
    },
    authHeaders: () => ({
      Authorization: `Bearer ${
        sessionStorage.getItem(TOKEN_KEY) || ""
      }`,
    }),
    apiFetch: secureFetch,
    logout: () => {
      clearSession();
      window.location.replace("login.html?logout=1");
    },
  };

  if (!isProtectedPage) {
    resolveReady(null);
    return;
  }

  const token = sessionStorage.getItem(TOKEN_KEY);

  if (!token) {
    redirectToLogin();
    return;
  }

  document.addEventListener("DOMContentLoaded", createAuthOverlay);

  nativeFetch(`${API_BASE}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        throw new Error(body.message || "Authentication failed.");
      }

      const user = body.data;
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));

      const finish = () => {
        updateUserInterface(user);
        removeAuthOverlay();
        resolveReady(user);

        window.dispatchEvent(
          new CustomEvent("protrade:auth-ready", { detail: user })
        );
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", finish, { once: true });
      } else {
        finish();
      }
    })
    .catch((error) => {
      console.error("Authentication check failed:", error);
      clearSession();
      rejectReady(error);
      redirectToLogin();
    });
})();
