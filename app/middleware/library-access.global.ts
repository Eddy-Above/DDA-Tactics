import dmAccess from './dm-access'

export default defineNuxtRouteMiddleware((to, from) => {
  if (!/^\/campaigns\/[^/]+\/library(?:\/|$)/i.test(to.path)) return

  // Page middleware does not inherit from the Library index page. Guard every
  // Library descendant, including direct requests and future editor routes.
  const middleware = to.meta.middleware
  if (middleware === 'dm-access' || Array.isArray(middleware) && middleware.includes('dm-access')) return
  return dmAccess(to, from)
})
