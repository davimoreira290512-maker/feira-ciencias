import { useEffect, useRef } from "react";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (
        element: HTMLElement,
        options: {
          type: "standard";
          theme: "outline";
          size: "large";
          text: "signin_with";
          shape: "rectangular";
          width: number;
          locale: string;
        },
      ) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
}

const GOOGLE_SCRIPT_ID = "google-identity-services";

export default function GoogleSignInButton({ onCredential }: GoogleSignInButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);

  useEffect(() => {
    onCredentialRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
    if (!clientId || !buttonRef.current) return;

    let active = true;
    const renderGoogleButton = () => {
      if (!active || !buttonRef.current || !window.google) return;
      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) onCredentialRef.current(response.credential);
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        width: 280,
        locale: "pt-BR",
      });
    };

    if (window.google) {
      renderGoogleButton();
    } else {
      let script = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = GOOGLE_SCRIPT_ID;
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderGoogleButton);
      if (script.dataset.loaded === "true") renderGoogleButton();
      script.addEventListener("error", renderGoogleButton);
    }

    return () => {
      active = false;
    };
  }, []);

  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()) {
    return (
      <p className="text-sm text-amber-800" role="alert">
        O login Google não está configurado neste ambiente.
      </p>
    );
  }

  return <div aria-label="Entrar com Google" ref={buttonRef} />;
}
