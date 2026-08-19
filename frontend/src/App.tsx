import { Routes, Route, Link } from 'react-router-dom'
import Feed from './pages/Feed'
import Login from './pages/Login'
import Register from './pages/Register'
import Profile from './pages/Profile'
import Requests from './pages/Requests'
import Settings from './pages/Settings'

function App() {
  return (
    <div className="min-h-screen">
      <nav className="flex gap-4 border-b p-4 text-sm">
        <Link to="/">Feed</Link>
        <Link to="/requests">Requests</Link>
        <Link to="/settings">Settings</Link>
        <Link to="/login">Log in</Link>
        <Link to="/register">Sign up</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/u/:username" element={<Profile />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
  )
}

export default App
