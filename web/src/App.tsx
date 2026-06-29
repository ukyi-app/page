import { Dashboard } from "./features/Dashboard";
import { LoginScreen } from "./features/LoginScreen";
import { useAuth } from "./hooks/useAuth";

export function App() {
  const { auth } = useAuth();
  return auth ? <Dashboard /> : <LoginScreen />;
}
