FROM ubuntu:14.04

# default values pf environment variables
# that are used inside container

ENV DEFAULT_WORKDIR /opt
ENV EXPLORER_APP_PATH $DEFAULT_WORKDIR/explorer

# database configuration
# ENV DATABASE_HOST 127.0.0.1
# ENV DATABASE_PORT 5432
# ENV DATABASE_NAME deepchain_explorer
# ENV DATABASE_USERNAME deepchain
# ENV DATABASE_PASSWD deepchain@019

ENV STARTUP_SCRIPT /opt

# set default working dir inside container
WORKDIR $DEFAULT_WORKDIR

# copy external data to container
COPY . $EXPLORER_APP_PATH

RUN echo "\
deb http://mirrors.163.com/ubuntu/ trusty main restricted universe multiverse \n\
deb http://mirrors.163.com/ubuntu/ trusty-security main restricted universe multiverse \n\
deb http://mirrors.163.com/ubuntu/ trusty-updates main restricted universe multiverse \n\
deb http://mirrors.163.com/ubuntu/ trusty-proposed main restricted universe multiverse \n\
deb http://mirrors.163.com/ubuntu/ trusty-backports main restricted universe multiverse \n\
deb-src http://mirrors.163.com/ubuntu/ trusty main restricted universe multiverse \n\
deb-src http://mirrors.163.com/ubuntu/ trusty-security main restricted universe multiverse \n\
deb-src http://mirrors.163.com/ubuntu/ trusty-updates main restricted universe multiverse \n\
deb-src http://mirrors.163.com/ubuntu/ trusty-proposed main restricted universe multiverse \n\
deb-src http://mirrors.163.com/ubuntu/ trusty-backports main restricted universe multiverse \
" > /etc/apt/sources.list

# install required dependencies by NPM packages:
# current dependencies are: python, make, g++
RUN apt-get -y update && apt-get install -y wget vim curl git gcc g++ make python
RUN curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
RUN sudo apt-get install -y nodejs

# install NPM dependencies
RUN cd $EXPLORER_APP_PATH && npm install && npm build

# run blockchain synchronizer
CMD node $EXPLORER_APP_PATH/sync.js && tail -f /dev/null
