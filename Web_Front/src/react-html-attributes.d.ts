import 'react';

declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    // Non-standard attributes for directory (folder) selection in file inputs.
    webkitdirectory?: string;
    directory?: string;
  }
}
