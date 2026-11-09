# Monitoring

The `kube-prometheus-stack` chart installs Prometheus, Grafana, Alertmanager, node
exporter and kube-state-metrics. The SheDrive ServiceMonitors scrape both app services;
the dashboard and alert rules are applied after the CRDs exist.

ECR/EKS load balancers and CloudWatch already cost money; this stack adds several pods.
For a two-node `t3.medium` demo cluster, watch memory pressure or temporarily disable
Alertmanager.

## Install

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

kubectl create namespace monitoring
cp k8s/monitoring/grafana-admin-secret.example.yaml \
   k8s/monitoring/grafana-admin-secret.yaml
# Edit the password, then:
kubectl apply -f k8s/monitoring/grafana-admin-secret.yaml

helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  -f k8s/monitoring/values-kube-prometheus-stack.yaml

kubectl apply -k k8s/monitoring
```

Wait for the stack:

```bash
kubectl get pods -n monitoring
kubectl get servicemonitors -n shedrive
kubectl get prometheusrules -n monitoring
```

The Grafana sidecar imports `shedrive-grafana-dashboard` into the **SheDrive** folder.
If the dashboard does not appear, confirm both Grafana and the sidecar are running and
that the ConfigMap has the `grafana_dashboard: "1"` label.

## Open Grafana

```bash
kubectl port-forward svc/grafana 3000:80 -n monitoring
```

Open <http://localhost:3000> and sign in with the credentials from
`shedrive-grafana-admin`. The dashboard is **SheDrive Operations**.

Useful Prometheus and Alertmanager views:

```bash
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring
kubectl port-forward svc/monitoring-kube-prometheus-alertmanager 9093:9093 -n monitoring
```

## Dashboard panels

- API request rate
- API p95 latency
- API 5xx error rate
- Active Socket.IO connections
- Drivers online
- Open SOS alerts
- Face verifications by decision (`auto_approved`, `needs_review`, `no_face`)
- Pod CPU and pod memory

## Alert rules

- backend or face-service scrape target down for 5 minutes
- API 5xx rate above 5 percent for 10 minutes
- p95 API latency above 1 second for 10 minutes
- an SOS alert open for 5 minutes
- more than half of face verifications returning `no_face` for 15 minutes

Alertmanager has no external receiver by default. Configure email or Slack in the Helm
values before relying on paging.

## Notes

- Prometheus uses emptyDir storage, so history is lost when its pod restarts. Add a PVC
  if the demo needs durable metrics.
- The backend `/metrics` endpoint is reachable through the public API load balancer.
  Restrict it at the load balancer or move metrics to an internal service before exposing
  the app beyond a classroom demo.
