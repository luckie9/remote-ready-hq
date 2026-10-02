// For Sign Up:
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: { full_name: fullName }
  }
})

// For Sign In:
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
})
