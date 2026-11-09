import os

# Must be set before the application is imported in test modules.
os.environ["PRELOAD_MODELS"] = "false"
os.environ["CONF_THRESHOLD"] = "0.85"

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client
