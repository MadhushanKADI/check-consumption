<<<<<<< HEAD
# # check-consumption

Dashboard showing the electricity consumption (kWh) of a UPS monitored by ViewPower.

ViewPower only reports load % (not watts or kWh), so the server polls it every 5 s, converts to watts using your UPS's rated real power, and integrates over time.

## Run

    node server.js

Open http://localhost:15180 and set your UPS rated power (W) in the form.

Environment variables: `VIEWPOWER_URL` (default `http://localhost:15178/ViewPower`), `UPS_PORT_NAME` (default `USB24875B93`), `UPS_RATED_WATTS` (default 600), `PORT` (default 15180), `HOST` (default `127.0.0.1`, localhost only; set `0.0.0.0` to expose on the LAN).

Readings accumulate in `data.json` only while the server is running. Stored values are load-percent-hours, so changing the rated watts re-scales history.
=======
# check-consumption
check-consumption

Web app that reads a ViewPower Monitor System UPS and shows energy used (kWh).

    DEMO=1 python3 app.py     # simulated readings
    VIEWPOWER_URL=http://host:15178/ViewPower/ POWER_REGEX='Load[^0-9]*(\d+)\s*W' python3 app.py

Open http://localhost:8000/. See `app.py` docstring for all settings
(`LOAD_REGEX` + `UPS_RATED_WATTS` can be used if only load % is exposed).
Run tests: `python3 -m unittest discover tests`.
>>>>>>> origin/main
