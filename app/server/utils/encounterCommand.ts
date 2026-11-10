import { defineEventHandler, getRouterParam, getMethod, getRequestURL, readBody, type H3Event } from 'h3'
import { runAttackCommand } from './attackCommand'

/** Commands share one queue, transaction and deferred publication boundary. */
export function defineEncounterCommand<T>(work: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async event => {
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
    const method = getMethod(event)
    const suffix = getRequestURL(event).pathname.split(`/encounters/${id}`)[1] ?? ''
    const action = suffix.startsWith('/actions/') ? suffix.split('/')[2]
      : suffix.startsWith('/requests/') ? 'requests-delete'
        : suffix.startsWith('/responses/') ? 'responses-delete'
          : suffix === '/requests' ? 'requests-create'
            : suffix === '/responses' ? 'response'
              : suffix === '/duplicate' ? 'duplicate'
                : method === 'DELETE' ? 'delete' : 'update'
    const body = method === 'DELETE' ? { requestId: getRouterParam(event, 'requestId'), responseId: getRouterParam(event, 'responseId') } : await readBody(event)
    return runAttackCommand(event, id, body, action, () => work(event))
  })
}
