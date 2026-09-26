"""Local stdio adapter. BRLTTY owns device drivers and computer-braille translation.
Requires the OS python3-brlapi package and a configured local BRLTTY daemon.
No raw USB packets and no simulated connected status.
"""
import json
import signal
import sys

def emit(**values):
    print(json.dumps(values), flush=True)

connection = None
try:
    import brlapi
    connection = brlapi.Connection()
    connection.enterTtyMode()
    columns, rows = connection.displaySize
    if columns < 1:
        raise RuntimeError('BRLTTY reports no display cells')
    driver = connection.driverName
    if isinstance(driver, bytes):
        driver = driver.decode('utf-8', errors='replace')
    emit(type='status', connected=True, columns=columns, rows=rows,
         driver=driver, message='Connected through BRLTTY')
    def stop(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    for line in sys.stdin:
        message = json.loads(line)
        if message.get('type') == 'write':
            text = message['text'][:columns]
            connection.writeText(text.ljust(columns), cursor=0)
            emit(type='written', text=text)
except Exception as error:
    emit(type='status', connected=False, message=str(error))
    sys.exit(1)
finally:
    if connection is not None:
        try:
            connection.leaveTtyMode()
        except Exception:
            pass
