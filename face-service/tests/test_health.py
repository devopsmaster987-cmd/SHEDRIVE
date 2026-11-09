def test_health_returns_service_metadata(client):
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    assert body["data"]["status"] == "ok"
    assert body["data"]["service"] == "shedrive-face-service"
    assert body["data"]["model"] == "Facenet512"
    assert body["data"]["detector_backend"] == "opencv"
    assert body["data"]["model_loaded"] is False
    assert body["data"]["confidence_threshold"] == 0.85


def test_metrics_are_exposed(client):
    response = client.get("/metrics")

    assert response.status_code == 200
    assert "http_requests_total" in response.text


def test_root_lists_endpoints(client):
    response = client.get("/")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["endpoints"]["verify"] == "/verify"
