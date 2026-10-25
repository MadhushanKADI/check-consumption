# check-consumption
check-consumption

Web app that reads a ViewPower Monitor System UPS and shows energy used (kWh).

    DEMO=1 python3 app.py     # simulated readings
    VIEWPOWER_URL=http://host:15178/ViewPower/ POWER_REGEX='Load[^0-9]*(\d+)\s*W' python3 app.py

Open http://localhost:8000/. See `app.py` docstring for all settings
(`LOAD_REGEX` + `UPS_RATED_WATTS` can be used if only load % is exposed).
Run tests: `python3 -m unittest discover tests`.
