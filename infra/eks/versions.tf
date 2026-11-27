terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.59"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Owner     = var.owner
      Project   = "openlocker-lab10"
      ManagedBy = "terraform"
    }
  }
}
