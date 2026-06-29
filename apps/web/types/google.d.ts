// Minimal ambient types for Google Identity Services (accounts.google.com/gsi/client).
// Loaded at runtime via <Script>; these cover only what we use.

interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
}

interface GoogleButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  type?: 'standard' | 'icon';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: string | number;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize(config: GoogleIdConfiguration): void;
        renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
        prompt(): void;
      };
    };
  };
}
