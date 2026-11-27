variable "region" {
  type    = string
  default = "ap-northeast-2"
}

variable "owner" {
  description = "Owner tag value (put it in terraform.tfvars on the server, not in Git)"
  type        = string
}

variable "cluster_name" {
  type    = string
  default = "openlocker-lab10"
}
