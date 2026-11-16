# HealthSync frontend

This React application is the frontend for the HealthSync API in `../backend`.

## Run locally

From this directory, install dependencies and start the development server:

```sh
npm ci
npm start
```

The app uses `http://localhost:5000/api` by default. To use a different API
endpoint, set `REACT_APP_API_URL` in a local `.env` file. Do not commit `.env`
files or put secrets in `REACT_APP_*` variables; Create React App embeds those
values in the browser bundle.

## Production build

```sh
npm run build
```

Set `REACT_APP_API_URL` to the deployed backend URL in the frontend hosting
provider's build environment. Committing this source to GitHub does not by
itself deploy or host the frontend.
