def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_gpu_endpoint_returns_status(client):
    response = client.get("/gpu")
    assert response.status_code == 200
    data = response.json()
    assert "name" in data
    assert "vram_used_gb" in data
    assert "vram_total_gb" in data
    assert "status" in data


def test_shutdown_endpoint_schedules_process_termination(client, monkeypatch):
    import threading

    terminated = threading.Event()
    monkeypatch.setattr("app.main._terminate_process", terminated.set)

    response = client.post("/shutdown")

    assert response.status_code == 200
    assert response.json() == {"status": "shutting down"}
    assert terminated.wait(timeout=1.0)

