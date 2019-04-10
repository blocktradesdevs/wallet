import { fromJS } from 'immutable';
import { call, put, select, takeEvery, takeLatest } from 'redux-saga/effects';
import tt from 'counterpart';
import { api } from '@steemit/steem-js';
import * as globalActions from './GlobalReducer';
import * as appActions from './AppReducer';
import * as transactionActions from './TransactionReducer';
import { setUserPreferences } from 'app/utils/ServerApiClient';
import { getStateAsync } from 'app/utils/steemApi';

const wait = ms =>
    new Promise(resolve => {
        setTimeout(() => resolve(), ms);
    });

export const sharedWatches = [
    takeEvery(globalActions.GET_STATE, getState),
    takeLatest([appActions.TOGGLE_NIGHTMODE], saveUserPreferences),
    takeEvery('transaction/ERROR', showTransactionErrorNotification),
];

export function* getAccount(username, force = false) {
    let account = yield select(state =>
        state.global.get('accounts').get(username)
    );

    // hive never serves `owner` prop (among others)
    let isLite = !!account && !account.get('owner');

    if (!account || force || isLite) {
        console.log(
            'getAccount: loading',
            username,
            'force?',
            force,
            'lite?',
            isLite
        );

        [account] = yield call([api, api.getAccountsAsync], [username]);
        if (account) {
            account = fromJS(account);
            yield put(globalActions.receiveAccount({ account }));
        }
    }
    return account;
}

/** Manual refreshes.  The router is in FetchDataSaga. */
export function* getState({ payload: { url } }) {
    try {
        const state = yield call(getStateAsync, url);
        yield put(globalActions.receiveState(state));
    } catch (error) {
        console.error('~~ Saga getState error ~~>', url, error);
        yield put(appActions.steemApiError(error.message));
    }
}

function* showTransactionErrorNotification() {
    const errors = yield select(state => state.transaction.get('errors'));
    for (const [key, message] of errors) {
        // Do not display a notification for the bandwidthError key.
        if (key !== 'bandwidthError') {
            yield put(appActions.addNotification({ key, message }));
            yield put(transactionActions.deleteError({ key }));
        }
    }
}

export function* listProposals({
    start,
    order_by,
    order_direction,
    limit,
    status,
    last_id,
    resolve,
    reject,
}) {
    let proposals;
    while (!proposals) {
        proposals = yield call(
            [api, api.listProposalsAsync],
            start,
            order_by,
            order_direction,
            limit,
            status,
            last_id
        );
    }

    yield put(globalActions.receiveListProposals({ proposals }));
    if (resolve && proposals) {
        resolve(proposals);
    } else if (reject && !proposals) {
        reject();
    }
}

export function* listVoterProposals({
    start,
    order_by,
    order_direction,
    limit,
    status,
    resolve,
    reject,
}) {
    let voterProposals = { [start]: [] };
    let last_id = null;
    let isLast = false;

    while (!isLast) {
        const data = yield call(
            [api, api.listVoterProposalsAsync],
            start,
            order_by,
            order_direction,
            limit,
            status,
            last_id
        );

        if (data) {
            if (!data.hasOwnProperty(start)) {
                isLast = true;
            } else {
                let proposals = [];

                if (data[start].length < limit) {
                    proposals = [...voterProposals[start], ...data[start]];
                    isLast = true;
                } else {
                    const nextProposals = [...data[start]];
                    last_id = nextProposals[nextProposals.length - 1]['id'];
                    nextProposals.splice(-1, 1);
                    proposals = [...voterProposals[start], ...nextProposals];
                }

                voterProposals = { [start]: proposals };
            }
        }
    }

    yield put(globalActions.receiveListVoterProposals({ voterProposals }));
    if (resolve && voterProposals[start].length > 0) {
        resolve(voterProposals);
    } else if (reject && !voterProposals) {
        reject();
    }
}

/**
 * Save this user's preferences, either directly from the submitted payload or from whatever's saved in the store currently.
 *
 * @param {Object?} params.payload
 */
function* saveUserPreferences({ payload }) {
    console.log('saveUserPreferences', payload);
    if (payload) {
        yield setUserPreferences(payload);
        return;
    }

    const prefs = yield select(state => state.app.get('user_preferences'));
    console.log('saveUserPreferences prefs', prefs);
    yield setUserPreferences(prefs.toJS());
}
