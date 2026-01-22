import { http, HttpResponse, passthrough } from 'msw';

export const handlers = [
  // Ignore Google Storage requests
  http.get('https://storage.googleapis.com/*', () => {
    return passthrough();
  }),

  // Define your other handlers here
  // Example: http.get('/api/user', () => HttpResponse.json({ name: 'John Doe' }))
];
