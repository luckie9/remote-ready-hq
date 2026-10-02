'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function AuthModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [message, setMessage] = useState('')

  if (!isOpen) return null

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setMessage(error.message)
      else setMessage('Account created! You can now log in.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMessage(error.message)
      else onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl max-w-md w-full text-white">
        <h2 className="text-xl font-bold mb-4">{isSignUp ? 'Create Account' : 'Sign In'}</h2>
        
        <form onSubmit={handleAuth} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-2 rounded bg-slate-800 border border-slate-700 text-white"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 rounded bg-slate-800 border border-slate-700 text-white"
            required
          />
          <button type="submit" className="w-full py-2 bg-emerald-600 rounded font-medium hover:bg-emerald-500">
            {isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        {message && <p className="mt-4 text-sm text-amber-400">{message}</p>}

        <button
          onClick={() => setIsSignUp(!isSignUp)}
          className="mt-4 text-xs text-slate-400 hover:underline block text-center w-full"
        >
          {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
        </button>
        
        <button onClick={onClose} className="mt-2 text-xs text-slate-500 block text-center w-full">
          Close
        </button>
      </div>
    </div>
  )
}
