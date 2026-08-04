import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { router } from './router';
import { suppressInputAutofill } from './lib/suppressInputAutofill';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);

// Default all text inputs/textareas to autocomplete="off" (fields that set their
// own autocomplete — e.g. sign-in — are left alone). Covers late-mounted modals.
suppressInputAutofill();
