import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';

export interface CustomerProfile {
  uid: string;
  name: string;
  email: string;
  phone: string;
}

export interface RegisterCustomerInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface LoginCustomerInput {
  email: string;
  password: string;
}

export function formatPhoneBr(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length > 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length > 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length > 2) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  return digits;
}

function translateFirebaseAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  const msg = error instanceof Error ? error.message : String(error);

  if (code === 'auth/email-already-in-use') {
    return 'Este e-mail já está cadastrado. Clique em "Entrar" para acessar sua conta.';
  }
  if (code === 'auth/invalid-email') {
    return 'Informe um endereço de e-mail válido.';
  }
  if (code === 'auth/weak-password') {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'E-mail ou senha incorretos. Confira seus dados e tente novamente.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Muitas tentativas seguidas. Aguarde alguns instantes e tente novamente.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'O login por E-mail e Senha ainda não foi ativado no Firebase Console deste projeto.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Falha de conexão com a internet. Verifique sua rede e tente novamente.';
  }

  return msg || 'Não foi possível concluir a autenticação. Tente novamente.';
}

async function fetchOrBuildProfile(user: User): Promise<CustomerProfile> {
  const path = `users/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const data = snap.data();
      return {
        uid: user.uid,
        name: String(data.name || user.displayName || 'Cliente Street Store'),
        email: String(data.email || user.email || ''),
        phone: String(data.phone || ''),
      };
    }
  } catch (error) {
    console.warn('[auth] Aviso ao ler perfil em Firestore:', error);
  }

  return {
    uid: user.uid,
    name: user.displayName || 'Cliente Street Store',
    email: user.email || '',
    phone: '',
  };
}

export async function registerCustomer(
  input: RegisterCustomerInput
): Promise<CustomerProfile> {
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();
  const phoneDigits = input.phone.replace(/\D/g, '');
  const formattedPhone = formatPhoneBr(phoneDigits);
  const password = input.password;

  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new Error('Informe seu nome completo (mínimo 2 caracteres).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Informe um e-mail válido.');
  }
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    throw new Error('Informe um telefone/WhatsApp válido com DDD (ex: (31) 98480-6556).');
  }
  if (password.length < 6) {
    throw new Error('Crie uma senha com pelo menos 6 caracteres.');
  }

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  } catch (error) {
    throw new Error(translateFirebaseAuthError(error));
  }

  const user = credential.user;

  try {
    await updateProfile(user, { displayName: cleanName });
  } catch {
    // Non-blocking fallback if displayName update fails
  }

  const path = `users/${user.uid}`;
  try {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      name: cleanName,
      email: cleanEmail,
      phone: formattedPhone,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    uid: user.uid,
    name: cleanName,
    email: cleanEmail,
    phone: formattedPhone,
  };
}

export async function loginCustomer(
  input: LoginCustomerInput
): Promise<CustomerProfile> {
  const cleanEmail = input.email.trim().toLowerCase();
  const password = input.password;

  if (!cleanEmail.includes('@')) {
    throw new Error('Informe um e-mail válido.');
  }
  if (!password) {
    throw new Error('Informe sua senha.');
  }

  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
  } catch (error) {
    throw new Error(translateFirebaseAuthError(error));
  }

  return fetchOrBuildProfile(credential.user);
}

export async function logoutCustomer(): Promise<void> {
  await signOut(auth);
}

export function subscribeToCustomerAuth(
  onChange: (profile: CustomerProfile | null) => void
): () => void {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onChange(null);
      return;
    }
    const profile = await fetchOrBuildProfile(user);
    onChange(profile);
  });
}
