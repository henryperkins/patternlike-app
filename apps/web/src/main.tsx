import { Auth0Provider } from "@auth0/auth0-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import {
  auth0ProviderOptions,
  isRedirectCallback,
} from "./lib/auth.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

const isAuth0Redirect = isRedirectCallback();

createRoot(root).render(
  <StrictMode>
    <Auth0Provider {...auth0ProviderOptions(window.location.origin)}>
      <App isAuth0Redirect={isAuth0Redirect} />
    </Auth0Provider>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
